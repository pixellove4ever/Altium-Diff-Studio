{==============================================================================}
{ Altium Diff Studio - Exporter Script                                         }
{                                                                              }
{ This DelphiScript module exports Schematic sheets, PCB layouts, and project  }
{ BOM data from Altium Designer to lightweight JSON files compatible with      }
{ Altium Diff Studio.                                                          }
{==============================================================================}

// Helper function to escape special characters in JSON strings
function EscapeStr(const S : String) : String;
var
    i : Integer;
    C : Char;
begin
    Result := '';
    for i := 1 to Length(S) do
    begin
        C := S[i];
        if C = '\' then Result := Result + '\\'
        else if C = '"' then Result := Result + '\"'
        else if C = #13 then Result := Result + '\r'
        else if C = #10 then Result := Result + '\n'
        else if C = #9 then Result := Result + '\t'
        else Result := Result + C;
    end;
end;

// Helper function to get the current project directory
function GetProjectPath : String;
var
    Workspace : IWorkSpace;
    Project   : IProject;
begin
    Result := '';
    Workspace := GetWorkSpace;
    if Workspace <> nil then
    begin
        Project := Workspace.DM_FocusedProject;
        if Project <> nil then
            Result := ExtractFilePath(Project.DM_ProjectFullPath);
    end;
    if Result = '' then
        Result := 'C:\';
end;

// ==============================================================================
// 1. EXPORT ACTIVE SCHEMATIC SHEET TO JSON
// ==============================================================================
procedure ExportSchDocToJson(SchDoc : ISch_Document; const SchPath : String);
var
    Iterator    : ISch_Iterator;
    Component   : ISch_Component;
    PinIterator : ISch_Iterator;
    Pin         : ISch_Pin;
    Wire        : ISch_Wire;
    NetLabel    : ISch_NetLabel;
    JsonList    : TStringList;
    FilePath    : String;
    FileName    : String;
    CompCount   : Integer;
    WireCount   : Integer;
    NetCount    : Integer;
    PinCount    : Integer;
begin
    if SchServer = nil then Exit;
    if SchDoc = nil then Exit;

    FileName := ExtractFileName(SchPath);
    if FileName = '' then
        FileName := ExtractFileName(SchDoc.DocumentName);
    FilePath := GetProjectPath + ChangeFileExt(FileName, '_sch.json');

    JsonList := TStringList.Create;
    try
        JsonList.Add('{');
        JsonList.Add('  "type": "schematic",');
        JsonList.Add('  "components": [');

        // Iterate Schematic Components
        CompCount := 0;
        Iterator := SchDoc.SchIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
        Component := Iterator.FirstSchObject;
        while Component <> nil do
        Begin
            if CompCount > 0 then JsonList.Add('    ,');
            
            JsonList.Add('    {');
            JsonList.Add('      "id": "' + Component.I_ObjectAddressStr + '",');
            JsonList.Add('      "designator": "' + EscapeStr(Component.Designator.Text) + '",');
            JsonList.Add('      "comment": "' + EscapeStr(Component.Comment.Text) + '",');
            JsonList.Add('      "libRef": "' + EscapeStr(Component.LibReference) + '",');
            JsonList.Add('      "x": ' + IntToStr(Component.Location.X) + ',');
            JsonList.Add('      "y": ' + IntToStr(Component.Location.Y) + ',');
            JsonList.Add('      "pins": [');

            // Iterate component pins
            PinCount := 0;
            PinIterator := Component.SchIterator_Create;
            PinIterator.AddFilter_ObjectSet(MkSet(ePin));
            Pin := PinIterator.FirstSchObject;
            while Pin <> nil do
            begin
                if PinCount > 0 then JsonList.Add('        ,');
                JsonList.Add('        {');
                JsonList.Add('          "id": "' + Pin.I_ObjectAddressStr + '",');
                JsonList.Add('          "name": "' + EscapeStr(Pin.Name) + '",');
                JsonList.Add('          "num": "' + EscapeStr(Pin.Designator) + '",');
                JsonList.Add('          "x": ' + IntToStr(Pin.Location.X) + ',');
                JsonList.Add('          "y": ' + IntToStr(Pin.Location.Y) + ',');
                JsonList.Add('          "orientation": ' + IntToStr(Pin.Orientation));
                JsonList.Add('        }');
                Inc(PinCount);
                Pin := PinIterator.NextSchObject;
            end;
            Component.SchIterator_Destroy(PinIterator);

            JsonList.Add('      ]');
            JsonList.Add('    }');
            
            Inc(CompCount);
            Component := Iterator.NextSchObject;
        end;
        SchDoc.SchIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        // Iterate Wires
        JsonList.Add('  "wires": [');
        WireCount := 0;
        Iterator := SchDoc.SchIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eWire));
        Wire := Iterator.FirstSchObject;
        while Wire <> nil do
        begin
            if WireCount > 0 then JsonList.Add('    ,');
            JsonList.Add('    {');
            JsonList.Add('      "id": "' + Wire.I_ObjectAddressStr + '",');
            JsonList.Add('      "start": { "x": ' + IntToStr(Wire.Location.X) + ', "y": ' + IntToStr(Wire.Location.Y) + ' },');
            JsonList.Add('      "end": { "x": ' + IntToStr(Wire.EndLocation.X) + ', "y": ' + IntToStr(Wire.EndLocation.Y) + ' }');
            JsonList.Add('    }');
            Inc(WireCount);
            Wire := Iterator.NextSchObject;
        end;
        SchDoc.SchIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        // Iterate Net Labels
        JsonList.Add('  "netLabels": [');
        NetCount := 0;
        Iterator := SchDoc.SchIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eNetLabel));
        NetLabel := Iterator.FirstSchObject;
        while NetLabel <> nil do
        begin
            if NetCount > 0 then JsonList.Add('    ,');
            JsonList.Add('    {');
            JsonList.Add('      "id": "' + NetLabel.I_ObjectAddressStr + '",');
            JsonList.Add('      "text": "' + EscapeStr(NetLabel.Text) + '",');
            JsonList.Add('      "x": ' + IntToStr(NetLabel.Location.X) + ',');
            JsonList.Add('      "y": ' + IntToStr(NetLabel.Location.Y));
            JsonList.Add('    }');
            Inc(NetCount);
            NetLabel := Iterator.NextSchObject;
        end;
        SchDoc.SchIterator_Destroy(Iterator);
        JsonList.Add('  ]');
        JsonList.Add('}');

        JsonList.SaveToFile(FilePath);
        // ShowMessage('Schematic exported successfully to:' + #13 + FilePath); // Désactivé pour la CI/CD
    finally
        JsonList.Free;
    end;
end;

// ==============================================================================
// 2. EXPORT ACTIVE PCB TO JSON
// ==============================================================================
procedure ExportPcbBoardToJson(PcbBoard : IPCB_Board; const PcbPath : String);
var
    Iterator    : IPCB_Iterator;
    Component   : IPCB_Component;
    Track       : IPCB_Track;
    Pad         : IPCB_Pad;
    Via         : IPCB_Via;
    JsonList    : TStringList;
    FilePath    : String;
    FileName    : String;
    Count       : Integer;
begin
    if PCBServer = nil then Exit;
    if PcbBoard = nil then Exit;

    FileName := ExtractFileName(PcbPath);
    if FileName = '' then
        FileName := ExtractFileName(PcbBoard.FileName);
    FilePath := GetProjectPath + ChangeFileExt(FileName, '_pcb.json');

    JsonList := TStringList.Create;
    try
        JsonList.Add('{');
        JsonList.Add('  "type": "pcb",');
        
        // 2a. Components
        JsonList.Add('  "components": [');
        Count := 0;
        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eComponentObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Component := Iterator.FirstPCBObject;
        while Component <> nil do
        begin
            if Count > 0 then JsonList.Add('    ,');
            JsonList.Add('    {');
            JsonList.Add('      "id": "' + Component.I_ObjectAddressStr + '",');
            JsonList.Add('      "designator": "' + EscapeStr(Component.Name.Text) + '",');
            JsonList.Add('      "comment": "' + EscapeStr(Component.Comment.Text) + '",');
            JsonList.Add('      "footprint": "' + EscapeStr(Component.Pattern) + '",');
            JsonList.Add('      "layer": "' + Layer2String(Component.Layer) + '",');
            JsonList.Add('      "x": ' + FloatToStr(CoordToMMs(Component.X)) + ',');
            JsonList.Add('      "y": ' + FloatToStr(CoordToMMs(Component.Y)) + ',');
            JsonList.Add('      "rotation": ' + FloatToStr(Component.Rotation));
            JsonList.Add('    }');
            Inc(Count);
            Component := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        // 2b. Tracks
        JsonList.Add('  "tracks": [');
        Count := 0;
        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eTrackObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Track := Iterator.FirstPCBObject;
        while Track <> nil do
        begin
            if (Track.Layer = eTopLayer) or
               (Track.Layer = eBottomLayer) or
               ((Track.Layer >= eMid1Layer) and (Track.Layer <= eMid30Layer)) then
            begin
                if Count > 0 then JsonList.Add('    ,');
                JsonList.Add('    {');
                JsonList.Add('      "id": "' + Track.I_ObjectAddressStr + '",');
                JsonList.Add('      "layer": "' + Layer2String(Track.Layer) + '",');
                JsonList.Add('      "start": { "x": ' + FloatToStr(CoordToMMs(Track.X1)) + ', "y": ' + FloatToStr(CoordToMMs(Track.Y1)) + ' },');
                JsonList.Add('      "end": { "x": ' + FloatToStr(CoordToMMs(Track.X2)) + ', "y": ' + FloatToStr(CoordToMMs(Track.Y2)) + ' },');
                JsonList.Add('      "width": ' + FloatToStr(CoordToMMs(Track.Width)) + ',');
                if Track.Net <> nil then
                    JsonList.Add('      "net": "' + EscapeStr(Track.Net.Name) + '"')
                else
                    JsonList.Add('      "net": ""');
                JsonList.Add('    }');
                Inc(Count);
            end;
            Track := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        // 2c. Pads
        JsonList.Add('  "pads": [');
        Count := 0;
        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(ePadObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Pad := Iterator.FirstPCBObject;
        while Pad <> nil do
        begin
            if Count > 0 then JsonList.Add('    ,');
            JsonList.Add('    {');
            JsonList.Add('      "id": "' + Pad.I_ObjectAddressStr + '",');
            JsonList.Add('      "designator": "' + EscapeStr(Pad.Name) + '",');
            if Pad.Component <> nil then
                JsonList.Add('      "component": "' + EscapeStr(Pad.Component.Name.Text) + '",')
            else
                JsonList.Add('      "component": "",');
            JsonList.Add('      "x": ' + FloatToStr(CoordToMMs(Pad.X)) + ',');
            JsonList.Add('      "y": ' + FloatToStr(CoordToMMs(Pad.Y)) + ',');
            JsonList.Add('      "size": { "x": ' + FloatToStr(CoordToMMs(Pad.TopXSize)) + ', "y": ' + FloatToStr(CoordToMMs(Pad.TopYSize)) + ' },');
            
            case Pad.TopShape of
                eRounded: JsonList.Add('      "shape": "round",');
                eRectangular: JsonList.Add('      "shape": "rectangular",');
                eOctagonal: JsonList.Add('      "shape": "octagonal",');
                else JsonList.Add('      "shape": "round",');
            end;

            JsonList.Add('      "holeSize": ' + FloatToStr(CoordToMMs(Pad.HoleSize)) + ',');
            JsonList.Add('      "layer": "' + Layer2String(Pad.Layer) + '",');
            if Pad.Net <> nil then
                JsonList.Add('      "net": "' + EscapeStr(Pad.Net.Name) + '"')
            else
                JsonList.Add('      "net": ""');
            JsonList.Add('    }');
            Inc(Count);
            Pad := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        // 2d. Vias
        JsonList.Add('  "vias": [');
        Count := 0;
        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eViaObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Via := Iterator.FirstPCBObject;
        while Via <> nil do
        begin
            if Count > 0 then JsonList.Add('    ,');
            JsonList.Add('    {');
            JsonList.Add('      "id": "' + Via.I_ObjectAddressStr + '",');
            JsonList.Add('      "x": ' + FloatToStr(CoordToMMs(Via.X)) + ',');
            JsonList.Add('      "y": ' + FloatToStr(CoordToMMs(Via.Y)) + ',');
            JsonList.Add('      "diameter": ' + FloatToStr(CoordToMMs(Via.Size)) + ',');
            JsonList.Add('      "holeSize": ' + FloatToStr(CoordToMMs(Via.HoleSize)) + ',');
            JsonList.Add('      "startLayer": "' + Layer2String(Via.LowLayer) + '",');
            JsonList.Add('      "endLayer": "' + Layer2String(Via.HighLayer) + '",');
            if Via.Net <> nil then
                JsonList.Add('      "net": "' + EscapeStr(Via.Net.Name) + '"')
            else
                JsonList.Add('      "net": ""');
            JsonList.Add('    }');
            Inc(Count);
            Via := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        // 2e. Copper Layers List
        JsonList.Add('  "layers": [');
        JsonList.Add('    "TopLayer", "BottomLayer"');
        JsonList.Add('  ]');
        JsonList.Add('}');

        JsonList.SaveToFile(FilePath);
        // ShowMessage('PCB exported successfully to:' + #13 + FilePath); // Désactivé pour la CI/CD
    finally
        JsonList.Free;
    end;
end;


// ------------------------------------------------------------------------------
// Wrappers and project-level export helpers
// ------------------------------------------------------------------------------
procedure ExportActiveSchToJson;
var
    SchDoc : ISch_Document;
begin
    if SchServer = nil then Exit;
    SchDoc := SchServer.GetCurrentSchDocument;
    if SchDoc <> nil then
        ExportSchDocToJson(SchDoc, SchDoc.DocumentName);
end;

procedure ExportActivePcbToJson;
var
    ActiveBoard : IPCB_Board;
begin
    if PCBServer = nil then Exit;
    ActiveBoard := PCBServer.GetCurrentPCBBoard;
    if ActiveBoard <> nil then
        ExportPcbBoardToJson(ActiveBoard, ActiveBoard.FileName);
end;

function LoadSchDocumentByPath(const SchPath : String) : ISch_Document;
var
    ServerDoc : IServerDocument;
begin
    Result := nil;
    if SchServer = nil then Exit;

    Result := SchServer.GetSchDocumentByPath(SchPath);
    if Result <> nil then Exit;

    if Client <> nil then
    begin
        ServerDoc := Client.OpenDocument('SCH', SchPath);
        if ServerDoc <> nil then
        begin
            Client.ShowDocument(ServerDoc);
            Result := SchServer.GetCurrentSchDocument;
        end;
    end;
end;

function LoadPcbBoardByPath(const PcbPath : String) : IPCB_Board;
var
    ServerDoc : IServerDocument;
begin
    Result := nil;
    if PCBServer = nil then Exit;

    if Client <> nil then
    begin
        ServerDoc := Client.OpenDocument('PCB', PcbPath);
        if ServerDoc <> nil then
            Client.ShowDocument(ServerDoc);
    end;

    Result := PCBServer.GetCurrentPCBBoard;
end;

procedure ExportAllProjectSchToJson;
var
    Workspace : IWorkSpace;
    Project   : IProject;
    Document  : IDocument;
    SchDoc    : ISch_Document;
    i         : Integer;
    Ext       : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then Exit;

    Project := Workspace.DM_FocusedProject;
    if Project = nil then Exit;

    for i := 0 to Project.DM_LogicalDocumentCount - 1 do
    begin
        Document := Project.DM_LogicalDocuments(i);
        Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));

        if Ext = '.SCHDOC' then
        begin
            SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
            if SchDoc <> nil then
                ExportSchDocToJson(SchDoc, Document.DM_FullPath);
        end;
    end;
end;

procedure ExportProjectPcbToJson;
var
    Workspace : IWorkSpace;
    Project   : IProject;
    Document  : IDocument;
    PcbBoard  : IPCB_Board;
    i         : Integer;
    Ext       : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then Exit;

    Project := Workspace.DM_FocusedProject;
    if Project = nil then Exit;

    for i := 0 to Project.DM_LogicalDocumentCount - 1 do
    begin
        Document := Project.DM_LogicalDocuments(i);
        Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));

        if Ext = '.PCBDOC' then
        begin
            PcbBoard := LoadPcbBoardByPath(Document.DM_FullPath);
            if PcbBoard <> nil then
                ExportPcbBoardToJson(PcbBoard, Document.DM_FullPath);
        end;
    end;
end;

// ==============================================================================
// 3. EXPORT PROJECT BILL OF MATERIALS (BOM) TO JSON
// ==============================================================================
procedure ExportProjectBomToJson;
var
    Workspace   : IWorkSpace;
    Project     : IProject;
    Document    : IDocument;
    SchDoc      : ISch_Document;
    Iterator    : ISch_Iterator;
    Component   : ISch_Component;
    Parameter   : ISch_Parameter;
    ParamIter   : ISch_Iterator;
    JsonList    : TStringList;
    FilePath    : String;
    i           : Integer;
    CompCount   : Integer;
    ParamCount  : Integer;
    Ext         : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then Exit;

    Project := Workspace.DM_FocusedProject;
    if Project = nil then Exit;

    FilePath := GetProjectPath + ChangeFileExt(ExtractFileName(Project.DM_ProjectFullPath), '_bom.json');
    JsonList := TStringList.Create;
    
    try
        JsonList.Add('{');
        JsonList.Add('  "type": "bom",');
        JsonList.Add('  "items": [');
        CompCount := 0;

        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));

            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    Iterator := SchDoc.SchIterator_Create;
                    Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
                    Component := Iterator.FirstSchObject;
                    
                    while Component <> nil do
                    begin
                        if (Component.Designator.Text <> '') and (Component.Designator.Text <> '*') then
                        begin
                            if CompCount > 0 then JsonList.Add('    ,');
                            
                            JsonList.Add('    {');
                            JsonList.Add('      "designator": "' + EscapeStr(Component.Designator.Text) + '",');
                            JsonList.Add('      "comment": "' + EscapeStr(Component.Comment.Text) + '",');
                            JsonList.Add('      "footprint": "' + EscapeStr(Component.ModelName) + '",');
                            JsonList.Add('      "libRef": "' + EscapeStr(Component.LibReference) + '",');
                            JsonList.Add('      "description": "' + EscapeStr(Component.Description) + '",');
                            JsonList.Add('      "quantity": 1,');
                            JsonList.Add('      "parameters": {');

                            ParamCount := 0;
                            ParamIter := Component.SchIterator_Create;
                            ParamIter.AddFilter_ObjectSet(MkSet(eParameter));
                            Parameter := ParamIter.FirstSchObject;
                            while Parameter <> nil do
                            begin
                                if (Parameter.Name <> 'Designator') and (Parameter.Name <> 'Comment') then
                                begin
                                    if ParamCount > 0 then JsonList.Add('        ,');
                                    JsonList.Add('        "' + EscapeStr(Parameter.Name) + '": "' + EscapeStr(Parameter.Text) + '"');
                                    Inc(ParamCount);
                                end;
                                Parameter := ParamIter.NextSchObject;
                            end;
                            Component.SchIterator_Destroy(ParamIter);

                            JsonList.Add('      }');
                            JsonList.Add('    }');
                            Inc(CompCount);
                        end;
                        Component := Iterator.NextSchObject;
                    end;
                    SchDoc.SchIterator_Destroy(Iterator);
                end;
            end;
        end;

        JsonList.Add('  ]');
        JsonList.Add('}');

        JsonList.SaveToFile(FilePath);
        // ShowMessage('Project BOM exported successfully to:' + #13 + FilePath); // Désactivé pour la CI/CD
    finally
        JsonList.Free;
    end;
end;

procedure ExportWholeProjectToJson;
begin
    ExportProjectPcbToJson;
    ExportAllProjectSchToJson;
    ExportProjectBomToJson;
end;

// ==============================================================================
// 4. OUTJOB REQUIRED ENTRYS (UNIVERSAL COMPLIANCE INTERFACE)
// ==============================================================================

function Configure(Parameters : String) : String;
begin
    Result := Parameters;
end;

function PredictOutputFileNames(Parameters : String) : String;
begin
    Result := GetProjectPath + '*.json';
end;

procedure Generate(Parameters : String);
var
    ParamUpper : String;
begin
    ParamUpper := AnsiUpperCase(Parameters);
    
    if Pos('PCB', ParamUpper) > 0 then
        ExportProjectPcbToJson
    else if Pos('SCH', ParamUpper) > 0 then
        ExportAllProjectSchToJson
    else if Pos('BOM', ParamUpper) > 0 then
        ExportProjectBomToJson
    else
        ExportWholeProjectToJson;
end;

function Run(Parameters : String) : String;
begin
    Generate(Parameters);
    Result := 'Success';
end;


// Direct script execution entry point.
begin
    Generate('');
    ShowMessage('Export JSON termine dans : ' + GetProjectPath);
end.
