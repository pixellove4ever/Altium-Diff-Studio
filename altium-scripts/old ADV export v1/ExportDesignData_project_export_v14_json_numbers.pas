{==============================================================================}
{ Altium Diff Studio - Exporter Script                                         }
{                                                                              }
{ This DelphiScript module exports Schematic sheets, PCB layouts, and project  }
{ BOM data from Altium Designer to lightweight JSON files compatible with      }
{ Altium Diff Studio.                                                          }
{==============================================================================}

const
    constKindPcb = 'PCB';

var
    CurrWorkSpace : IWorkSpace;
    CurrProject   : IProject;
    TargetFolder  : String;
    TargetFileName: String;
    TargetPrefix  : String;

function AddTrailingSlash(const S : String) : String;
begin
    Result := S;
    if Result = '' then Exit;
    if Copy(Result, Length(Result), 1) <> '\' then
        Result := Result + '\';
end;

function ExtractParameterValue(const Parameters : String; const Key : String; var Value : String) : Boolean;
var
    P, E : Integer;
    SearchKey : String;
begin
    Result := False;
    Value := '';
    SearchKey := Key + '=';
    P := Pos(SearchKey, Parameters);
    if P = 0 then Exit;

    P := P + Length(SearchKey);
    E := P;
    while (E <= Length(Parameters)) and
          (Copy(Parameters, E, 1) <> '|') and
          (Copy(Parameters, E, 1) <> ';') and
          (Copy(Parameters, E, 1) <> #13) and
          (Copy(Parameters, E, 1) <> #10) do
        Inc(E);

    Value := Copy(Parameters, P, E - P);
    Result := True;
end;

procedure InitializeOutputContext(const Parameters : String);
var
    S : String;
begin
    CurrWorkSpace := GetWorkSpace;
    if CurrWorkSpace <> nil then
        CurrProject := CurrWorkSpace.DM_FocusedProject;

    TargetFolder := '';
    TargetFileName := '';
    TargetPrefix := '';

    if CurrProject <> nil then
    begin
        TargetFolder := CurrProject.DM_GetOutputPath;
        if TargetFolder = '' then
            TargetFolder := ExtractFilePath(CurrProject.DM_ProjectFullPath);

        TargetFileName := CurrProject.DM_ProjectFileName;
        if TargetFileName = '' then
            TargetFileName := ExtractFileName(CurrProject.DM_ProjectFullPath);
    end;

    if ExtractParameterValue(Parameters, 'TargetFolder', S) then
        TargetFolder := S;
    if ExtractParameterValue(Parameters, 'TargetFileName', S) then
        TargetFileName := S + '.PrjPcb';
    if ExtractParameterValue(Parameters, 'TargetPrefix', S) then
        TargetPrefix := S;

    if TargetFolder = '' then
        TargetFolder := 'C:\';

    TargetFolder := AddTrailingSlash(TargetFolder);
end;

function GetOutputFileNameWithSuffix(const Suffix : String) : String;
var
    BaseName : String;
begin
    if TargetFolder = '' then
        InitializeOutputContext('');

    BaseName := TargetFileName;
    if BaseName = '' then
        BaseName := 'AltiumProject.PrjPcb';

    Result := TargetFolder + TargetPrefix + ChangeFileExt(BaseName, Suffix);
end;



// Format a floating point number as JSON numeric literal regardless of Windows locale
function JsonFloat(Value : Double) : String;
var
    i : Integer;
begin
    Result := FloatToStr(Value);
    for i := 1 to Length(Result) do
        if Result[i] = ',' then
            Result[i] := '.';
end;

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

// Helper function to get the OutJob/project output directory
function GetProjectPath : String;
begin
    if TargetFolder = '' then
        InitializeOutputContext('');
    Result := TargetFolder;
end;


// Helper function to read a schematic component parameter by name
function GetComponentParameterText(Component : ISch_Component; const ParamName : String) : String;
var
    ParamIter  : ISch_Iterator;
    Parameter  : ISch_Parameter;
    WantedName : String;
begin
    Result := '';
    if Component = nil then Exit;

    WantedName := AnsiUpperCase(ParamName);
    ParamIter := Component.SchIterator_Create;
    if ParamIter = nil then Exit;

    ParamIter.AddFilter_ObjectSet(MkSet(eParameter));
    Parameter := ParamIter.FirstSchObject;
    while Parameter <> nil do
    begin
        if AnsiUpperCase(Parameter.Name) = WantedName then
        begin
            Result := Parameter.Text;
            Break;
        end;
        Parameter := ParamIter.NextSchObject;
    end;
    Component.SchIterator_Destroy(ParamIter);
end;


// Helper procedure to append diagnostic lines in the project folder
procedure AppendExportLog(const Msg : String);
var
    L : TStringList;
    LogPath : String;
begin
    LogPath := GetProjectPath + 'export_design_data_debug.txt';
    L := TStringList.Create;
    try
        if FileExists(LogPath) then
            L.LoadFromFile(LogPath);
        L.Add(Msg);
        L.SaveToFile(LogPath);
    finally
        L.Free;
    end;
end;

procedure WriteProbeJson;
var
    L : TStringList;
    ProbePath : String;
begin
    ProbePath := GetProjectPath + 'export_probe.json';
    L := TStringList.Create;
    try
        L.Add('{');
        L.Add('  "type": "probe",');
        L.Add('  "message": "Generate was called",');
        L.Add('  "projectPath": "' + EscapeStr(GetProjectPath) + '"');
        L.Add('}');
        L.SaveToFile(ProbePath);
        AppendExportLog('Probe JSON written: ' + ProbePath);
    finally
        L.Free;
    end;
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
    VertexIndex : Integer;
    ALocation   : TLocation;
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
            JsonList.Add('      "id": "' + 'SCHCOMP_' + IntToStr(CompCount) + '",');
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
                JsonList.Add('          "id": "' + 'PIN_' + IntToStr(CompCount) + '_' + IntToStr(PinCount) + '",');
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
            JsonList.Add('      "id": "' + 'WIRE_' + IntToStr(WireCount) + '",');
            JsonList.Add('      "points": [');
            for VertexIndex := 1 to Wire.VerticesCount do
            begin
                ALocation := Wire.GetState_Vertex(VertexIndex);
                if VertexIndex > 1 then JsonList.Add('        ,');
                JsonList.Add('        { "x": ' + IntToStr(ALocation.X) + ', "y": ' + IntToStr(ALocation.Y) + ' }');
            end;
            JsonList.Add('      ]');
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
            JsonList.Add('      "id": "' + 'NETLABEL_' + IntToStr(NetCount) + '",');
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

        AppendExportLog('Saving SCH JSON: ' + FilePath);
        JsonList.SaveToFile(FilePath);
        AppendExportLog('Saved SCH JSON: ' + FilePath);
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
            JsonList.Add('      "id": "' + 'PCBCOMP_' + IntToStr(Count) + '",');
            JsonList.Add('      "designator": "' + EscapeStr(Component.Name.Text) + '",');
            JsonList.Add('      "comment": "' + EscapeStr(Component.Comment.Text) + '",');
            JsonList.Add('      "footprint": "' + EscapeStr(Component.Pattern) + '",');
            JsonList.Add('      "layer": "' + Layer2String(Component.Layer) + '",');
            JsonList.Add('      "x": ' + JsonFloat(CoordToMMs(Component.X)) + ',');
            JsonList.Add('      "y": ' + JsonFloat(CoordToMMs(Component.Y)) + ',');
            JsonList.Add('      "rotation": ' + JsonFloat(Component.Rotation));
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
               ((Track.Layer >= 1) and (Track.Layer <= 32)) then
            begin
                if Count > 0 then JsonList.Add('    ,');
                JsonList.Add('    {');
                JsonList.Add('      "id": "' + 'TRACK_' + IntToStr(Count) + '",');
                JsonList.Add('      "layer": "' + Layer2String(Track.Layer) + '",');
                JsonList.Add('      "start": { "x": ' + JsonFloat(CoordToMMs(Track.X1)) + ', "y": ' + JsonFloat(CoordToMMs(Track.Y1)) + ' },');
                JsonList.Add('      "end": { "x": ' + JsonFloat(CoordToMMs(Track.X2)) + ', "y": ' + JsonFloat(CoordToMMs(Track.Y2)) + ' },');
                JsonList.Add('      "width": ' + JsonFloat(CoordToMMs(Track.Width)) + ',');
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
            JsonList.Add('      "id": "' + 'PAD_' + IntToStr(Count) + '",');
            JsonList.Add('      "designator": "' + EscapeStr(Pad.Name) + '",');
            if Pad.Component <> nil then
                JsonList.Add('      "component": "' + EscapeStr(Pad.Component.Name.Text) + '",')
            else
                JsonList.Add('      "component": "",');
            JsonList.Add('      "x": ' + JsonFloat(CoordToMMs(Pad.X)) + ',');
            JsonList.Add('      "y": ' + JsonFloat(CoordToMMs(Pad.Y)) + ',');
            JsonList.Add('      "size": { "x": ' + JsonFloat(CoordToMMs(Pad.TopXSize)) + ', "y": ' + JsonFloat(CoordToMMs(Pad.TopYSize)) + ' },');
            
            case Pad.TopShape of
                eRounded: JsonList.Add('      "shape": "round",');
                eRectangular: JsonList.Add('      "shape": "rectangular",');
                eOctagonal: JsonList.Add('      "shape": "octagonal",');
                else JsonList.Add('      "shape": "round",');
            end;

            JsonList.Add('      "holeSize": ' + JsonFloat(CoordToMMs(Pad.HoleSize)) + ',');
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
            JsonList.Add('      "id": "' + 'VIA_' + IntToStr(Count) + '",');
            JsonList.Add('      "x": ' + JsonFloat(CoordToMMs(Via.X)) + ',');
            JsonList.Add('      "y": ' + JsonFloat(CoordToMMs(Via.Y)) + ',');
            JsonList.Add('      "diameter": ' + JsonFloat(CoordToMMs(Via.Size)) + ',');
            JsonList.Add('      "holeSize": ' + JsonFloat(CoordToMMs(Via.HoleSize)) + ',');
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

        AppendExportLog('Saving PCB JSON: ' + FilePath);
        JsonList.SaveToFile(FilePath);
        AppendExportLog('Saved PCB JSON: ' + FilePath);
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
    if Project = nil then begin AppendExportLog('No focused project in ExportAllProjectSchToJson'); Exit; end;

    AppendExportLog('SCH logical document count: ' + IntToStr(Project.DM_LogicalDocumentCount));
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
    if Project = nil then begin AppendExportLog('No focused project in ExportProjectPcbToJson'); Exit; end;

    AppendExportLog('PCB logical document count: ' + IntToStr(Project.DM_LogicalDocumentCount));
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
    if Project = nil then begin AppendExportLog('No focused project in ExportProjectBomToJson'); Exit; end;

    AppendExportLog('BOM logical document count: ' + IntToStr(Project.DM_LogicalDocumentCount));
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
                            JsonList.Add('      "footprint": "' + EscapeStr(GetComponentParameterText(Component, 'Footprint')) + '",');
                            JsonList.Add('      "libRef": "' + EscapeStr(Component.LibReference) + '",');
                            JsonList.Add('      "description": "' + EscapeStr(GetComponentParameterText(Component, 'Description')) + '",');
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

        AppendExportLog('Saving BOM JSON: ' + FilePath);
        JsonList.SaveToFile(FilePath);
        AppendExportLog('Saved BOM JSON: ' + FilePath);
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
// 4. OUTJOB REQUIRED ENTRIES
// ==============================================================================

function Configure(Parameters : String) : String;
begin
    InitializeOutputContext(Parameters);
    Result := Parameters;
end;

function PredictOutputFileNames(Parameters : String) : String;
var
    OutputFileNames : TStringList;
begin
    InitializeOutputContext(Parameters);

    OutputFileNames := TStringList.Create;
    OutputFileNames.Delimiter := '|';
    OutputFileNames.StrictDelimiter := True;
    try
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_bom.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_pcb.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + 'export_probe.json');
        OutputFileNames.Add(GetProjectPath + TargetPrefix + 'export_design_data_debug.txt');
        Result := OutputFileNames.DelimitedText;
    finally
        OutputFileNames.Free;
    end;
end;

procedure Generate(Parameters : String);
var
    ParamUpper : String;
begin
    InitializeOutputContext(Parameters);

    AppendExportLog('--- Generate called ---');
    AppendExportLog('Parameters: ' + Parameters);
    AppendExportLog('Output folder: ' + GetProjectPath);
    WriteProbeJson;

    ParamUpper := AnsiUpperCase(Parameters);

    if Pos('PCB', ParamUpper) > 0 then
        ExportProjectPcbToJson
    else if Pos('SCH', ParamUpper) > 0 then
        ExportAllProjectSchToJson
    else if Pos('BOM', ParamUpper) > 0 then
        ExportProjectBomToJson
    else
        ExportWholeProjectToJson;

    AppendExportLog('--- Generate finished ---');
end;

procedure RunScript;
begin
    Generate('');
    ShowMessage('Export JSON termine dans : ' + GetProjectPath);
end;

function Run(Parameters : String) : String;
begin
    Generate(Parameters);
    Result := 'Success';
end;
