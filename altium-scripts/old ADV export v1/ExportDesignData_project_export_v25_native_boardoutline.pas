{==============================================================================}
{ Altium Diff Studio - Exporter Script v23                                         }
{                                                                              }
{ This DelphiScript module exports Schematic sheets, PCB layouts, copper/plane placeholders, and project  }
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


function IsDigitChar(C : Char) : Boolean;
begin
    Result := (C >= '0') and (C <= '9');
end;

function IsFRVariantSuffix(const Suffix : String) : Boolean;
var
    i : Integer;
begin
    Result := False;
    if Length(Suffix) < 4 then Exit;          { _FR0 }
    if Copy(Suffix, 1, 3) <> '_FR' then Exit;

    for i := 4 to Length(Suffix) do
        if not IsDigitChar(Suffix[i]) then
            Exit;

    Result := True;
end;

function BaseDesignatorOf(const Designator : String) : String;
var
    i : Integer;
    Suffix : String;
begin
    Result := Designator;

    { Normalize panel/variant suffixes such as C319_FR0, TP300_FR3.
      The original designator is preserved in "designator"; this only adds a
      comparison-friendly key. }
    for i := Length(Designator) downto 1 do
    begin
        if Designator[i] = '_' then
        begin
            Suffix := Copy(Designator, i, Length(Designator) - i + 1);
            if IsFRVariantSuffix(Suffix) then
                Result := Copy(Designator, 1, i - 1);
            Exit;
        end;
    end;
end;

procedure IncludeBoundsPoint(var HasBounds : Boolean; var MinX : Double; var MinY : Double; var MaxX : Double; var MaxY : Double; X : Double; Y : Double);
begin
    if not HasBounds then
    begin
        HasBounds := True;
        MinX := X;
        MaxX := X;
        MinY := Y;
        MaxY := Y;
    end
    else
    begin
        if X < MinX then MinX := X;
        if X > MaxX then MaxX := X;
        if Y < MinY then MinY := Y;
        if Y > MaxY then MaxY := Y;
    end;
end;

procedure AddPcbBoardOutlineJson(PcbBoard : IPCB_Board; JsonList : TStringList);
var
    Iterator       : IPCB_Iterator;
    Component      : IPCB_Component;
    Track          : IPCB_Track;
    Pad            : IPCB_Pad;
    Via            : IPCB_Via;
    HasBounds      : Boolean;
    MinX           : Double;
    MinY           : Double;
    MaxX           : Double;
    MaxY           : Double;
    Margin         : Double;
    OutlineSource  : String;
begin
    HasBounds := False;
    MinX := 0;
    MinY := 0;
    MaxX := 0;
    MaxY := 0;
    OutlineSource := 'none';

    { V25 outline strategy:
      1) Prefer the native Altium BoardOutline bounding rectangle. This comes from
         the board shape object instead of ordinary primitives on Mechanical Layer 1.
         It is therefore more reliable than the v25 mechanical fallback.
      2) Keep the previous all-object bounding fallback only if the native outline is
         unavailable in the target Altium build.

      Note: some Altium scripting builds expose the board shape only as a bounding
      rectangle through Board.BoardOutline.BoundingRectangle. This is still not a
      full vertex/polyline contour, but it validates native Board Shape access and
      gives the viewer a source flag it can trust. }

    if PcbBoard.BoardOutline <> nil then
    begin
        MinX := CoordToMMs(PcbBoard.BoardOutline.BoundingRectangle.Left);
        MinY := CoordToMMs(PcbBoard.BoardOutline.BoundingRectangle.Bottom);
        MaxX := CoordToMMs(PcbBoard.BoardOutline.BoundingRectangle.Right);
        MaxY := CoordToMMs(PcbBoard.BoardOutline.BoundingRectangle.Top);
        HasBounds := True;
        OutlineSource := 'nativeBoardOutlineBoundingRectangle';
    end;

    if not HasBounds then
    begin
        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eComponentObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Component := Iterator.FirstPCBObject;
        while Component <> nil do
        begin
            IncludeBoundsPoint(HasBounds, MinX, MinY, MaxX, MaxY, CoordToMMs(Component.X), CoordToMMs(Component.Y));
            Component := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);

        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eTrackObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Track := Iterator.FirstPCBObject;
        while Track <> nil do
        begin
            IncludeBoundsPoint(HasBounds, MinX, MinY, MaxX, MaxY, CoordToMMs(Track.X1), CoordToMMs(Track.Y1));
            IncludeBoundsPoint(HasBounds, MinX, MinY, MaxX, MaxY, CoordToMMs(Track.X2), CoordToMMs(Track.Y2));
            Track := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);

        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(ePadObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Pad := Iterator.FirstPCBObject;
        while Pad <> nil do
        begin
            IncludeBoundsPoint(HasBounds, MinX, MinY, MaxX, MaxY, CoordToMMs(Pad.X), CoordToMMs(Pad.Y));
            Pad := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);

        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eViaObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Via := Iterator.FirstPCBObject;
        while Via <> nil do
        begin
            IncludeBoundsPoint(HasBounds, MinX, MinY, MaxX, MaxY, CoordToMMs(Via.X), CoordToMMs(Via.Y));
            Via := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);

        OutlineSource := 'allObjectBoundingBoxFallback';
    end;

    if not HasBounds then
    begin
        JsonList.Add('  "boardOutline": [],');
        JsonList.Add('  "boardOutlineSource": "none",');
        Exit;
    end;

    Margin := 0.0;
    if OutlineSource = 'allObjectBoundingBoxFallback' then
        Margin := 2.0;

    MinX := MinX - Margin;
    MinY := MinY - Margin;
    MaxX := MaxX + Margin;
    MaxY := MaxY + Margin;

    JsonList.Add('  "boardOutline": [');
    JsonList.Add('    { "x": ' + JsonFloat(MinX) + ', "y": ' + JsonFloat(MinY) + ' },');
    JsonList.Add('    { "x": ' + JsonFloat(MaxX) + ', "y": ' + JsonFloat(MinY) + ' },');
    JsonList.Add('    { "x": ' + JsonFloat(MaxX) + ', "y": ' + JsonFloat(MaxY) + ' },');
    JsonList.Add('    { "x": ' + JsonFloat(MinX) + ', "y": ' + JsonFloat(MaxY) + ' },');
    JsonList.Add('    { "x": ' + JsonFloat(MinX) + ', "y": ' + JsonFloat(MinY) + ' }');
    JsonList.Add('  ],');
    JsonList.Add('  "boardOutlineSource": "' + OutlineSource + '",');
end;

// Helper functions to escape special characters in JSON strings
function HexDigit(N : Integer) : Char;
begin
    if N < 10 then
        Result := Chr(Ord('0') + N)
    else
        Result := Chr(Ord('A') + N - 10);
end;

function Hex4(N : Integer) : String;
begin
    Result := HexDigit((N div 4096) mod 16) +
              HexDigit((N div 256) mod 16) +
              HexDigit((N div 16) mod 16) +
              HexDigit(N mod 16);
end;

function EscapeStr(const S : String) : String;
var
    i : Integer;
    C : Char;
    Code : Integer;
begin
    Result := '';
    for i := 1 to Length(S) do
    begin
        C := S[i];
        Code := Ord(C);
        if C = '\' then Result := Result + '\\'
        else if C = '"' then Result := Result + '"'
        else if C = #13 then Result := Result + '\r'
        else if C = #10 then Result := Result + '\n'
        else if C = #9 then Result := Result + '\t'
        else if (Code < 32) or (Code > 126) then Result := Result + '\u' + Hex4(Code)
        else Result := Result + C;
    end;
end;

function GetProjectPath : String;
begin
    if TargetFolder = '' then
        InitializeOutputContext('');
    Result := TargetFolder;
end;

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

function JsonKeyAlreadyWritten(Keys : TStringList; const Key : String) : Boolean;
var
    UpperKey : String;
begin
    Result := False;
    if Keys = nil then Exit;
    UpperKey := AnsiUpperCase(Key);
    if Keys.IndexOf(UpperKey) >= 0 then
        Result := True
    else
        Keys.Add(UpperKey);
end;


procedure AddExporterMetadata(JsonList : TStringList);
begin
    JsonList.Add('  "exporter": {');
    JsonList.Add('    "scriptName": "ExportDesignData.pas",');
    JsonList.Add('    "scriptVersion": "v25",');
    JsonList.Add('    "schemaVersion": "ads-json-v25"');
    JsonList.Add('  },');
end;

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

{==============================================================================}
{ 1. EXPORT SCHEMATIC SHEETS TO ONE PROJECT-LEVEL JSON                         }
{==============================================================================}

procedure IncludeSchBoundsPoint(var HasBounds : Boolean; var MinX : Integer; var MinY : Integer; var MaxX : Integer; var MaxY : Integer; X : Integer; Y : Integer);
begin
    if not HasBounds then
    begin
        HasBounds := True;
        MinX := X;
        MaxX := X;
        MinY := Y;
        MaxY := Y;
    end
    else
    begin
        if X < MinX then MinX := X;
        if X > MaxX then MaxX := X;
        if Y < MinY then MinY := Y;
        if Y > MaxY then MaxY := Y;
    end;
end;

procedure AddSchDocToSchematicJson(JsonList : TStringList; SchDoc : ISch_Document; const SchPath : String; SheetIndex : Integer);
var
    Iterator    : ISch_Iterator;
    Component   : ISch_Component;
    PinIterator : ISch_Iterator;
    Pin         : ISch_Pin;
    Wire        : ISch_Wire;
    NetLabel    : ISch_NetLabel;
    FileName    : String;
    CompCount   : Integer;
    WireCount   : Integer;
    NetCount    : Integer;
    PinCount    : Integer;
    VertexIndex : Integer;
    ALocation   : TLocation;
    HasCompBounds : Boolean;
    CompMinX    : Integer;
    CompMinY    : Integer;
    CompMaxX    : Integer;
    CompMaxY    : Integer;
    BoundsMargin : Integer;
begin
    if SchDoc = nil then Exit;

    FileName := ExtractFileName(SchPath);
    if FileName = '' then
        FileName := ExtractFileName(SchDoc.DocumentName);

    JsonList.Add('    {');
    JsonList.Add('      "id": "SHEET_' + IntToStr(SheetIndex) + '",');
    JsonList.Add('      "name": "' + EscapeStr(ChangeFileExt(FileName, '')) + '",');
    JsonList.Add('      "path": "' + EscapeStr(SchPath) + '",');
    JsonList.Add('      "schematicExportLevel": "logicalPlusFallbackGraphicsV25",');
    JsonList.Add('      "graphicsNotes": "Symbol bodies are bounding-box fallbacks derived from component pins; native Altium symbol primitives, ports, power ports, buses and directives are reserved in typed arrays when API-compatible extraction is added.",');
    JsonList.Add('      "components": [');

    CompCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eSchComponent));
    Component := Iterator.FirstSchObject;
    while Component <> nil do
    Begin
        BoundsMargin := 500000;
        HasCompBounds := False;
        IncludeSchBoundsPoint(HasCompBounds, CompMinX, CompMinY, CompMaxX, CompMaxY, Component.Location.X, Component.Location.Y);

        if CompCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_SCHCOMP_' + IntToStr(CompCount) + '",');
        JsonList.Add('          "designator": "' + EscapeStr(Component.Designator.Text) + '",');
        JsonList.Add('          "comment": "' + EscapeStr(Component.Comment.Text) + '",');
        JsonList.Add('          "libRef": "' + EscapeStr(Component.LibReference) + '",');
        JsonList.Add('          "x": ' + IntToStr(Component.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(Component.Location.Y) + ',');
        JsonList.Add('          "pins": [');

        PinCount := 0;
        PinIterator := Component.SchIterator_Create;
        PinIterator.AddFilter_ObjectSet(MkSet(ePin));
        Pin := PinIterator.FirstSchObject;
        while Pin <> nil do
        begin
            if PinCount > 0 then JsonList.Add('            ,');
            JsonList.Add('            {');
            JsonList.Add('              "id": "SHEET_' + IntToStr(SheetIndex) + '_PIN_' + IntToStr(CompCount) + '_' + IntToStr(PinCount) + '",');
            JsonList.Add('              "name": "' + EscapeStr(Pin.Name) + '",');
            JsonList.Add('              "num": "' + EscapeStr(Pin.Designator) + '",');
            JsonList.Add('              "x": ' + IntToStr(Pin.Location.X) + ',');
            JsonList.Add('              "y": ' + IntToStr(Pin.Location.Y) + ',');
            JsonList.Add('              "orientation": ' + IntToStr(Pin.Orientation));
            JsonList.Add('            }');
            IncludeSchBoundsPoint(HasCompBounds, CompMinX, CompMinY, CompMaxX, CompMaxY, Pin.Location.X, Pin.Location.Y);
            Inc(PinCount);
            Pin := PinIterator.NextSchObject;
        end;
        Component.SchIterator_Destroy(PinIterator);

        JsonList.Add('          ],');
        if HasCompBounds then
        begin
            JsonList.Add('          "bounds": { "x1": ' + IntToStr(CompMinX - BoundsMargin) + ', "y1": ' + IntToStr(CompMinY - BoundsMargin) + ', "x2": ' + IntToStr(CompMaxX + BoundsMargin) + ', "y2": ' + IntToStr(CompMaxY + BoundsMargin) + ' },');
            JsonList.Add('          "symbolGraphics": [');
            JsonList.Add('            { "type": "rect", "source": "pinBoundsFallback", "x1": ' + IntToStr(CompMinX - BoundsMargin) + ', "y1": ' + IntToStr(CompMinY - BoundsMargin) + ', "x2": ' + IntToStr(CompMaxX + BoundsMargin) + ', "y2": ' + IntToStr(CompMaxY + BoundsMargin) + ' }');
            JsonList.Add('          ]');
        end
        else
        begin
            JsonList.Add('          "bounds": null,');
            JsonList.Add('          "symbolGraphics": []');
        end;
        JsonList.Add('        }');
        Inc(CompCount);
        Component := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "wires": [');
    WireCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eWire));
    Wire := Iterator.FirstSchObject;
    while Wire <> nil do
    begin
        if WireCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_WIRE_' + IntToStr(WireCount) + '",');
        JsonList.Add('          "points": [');
        for VertexIndex := 1 to Wire.VerticesCount do
        begin
            ALocation := Wire.GetState_Vertex(VertexIndex);
            if VertexIndex > 1 then JsonList.Add('            ,');
            JsonList.Add('            { "x": ' + IntToStr(ALocation.X) + ', "y": ' + IntToStr(ALocation.Y) + ' }');
        end;
        JsonList.Add('          ]');
        JsonList.Add('        }');
        Inc(WireCount);
        Wire := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "netLabels": [');
    NetCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eNetLabel));
    NetLabel := Iterator.FirstSchObject;
    while NetLabel <> nil do
    begin
        if NetCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_NETLABEL_' + IntToStr(NetCount) + '",');
        JsonList.Add('          "text": "' + EscapeStr(NetLabel.Text) + '",');
        JsonList.Add('          "x": ' + IntToStr(NetLabel.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(NetLabel.Location.Y));
        JsonList.Add('        }');
        Inc(NetCount);
        NetLabel := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');
    JsonList.Add('      "ports": [],');
    JsonList.Add('      "powerPorts": [],');
    JsonList.Add('      "offSheetConnectors": [],');
    JsonList.Add('      "sheetSymbols": [],');
    JsonList.Add('      "junctions": [],');
    JsonList.Add('      "noERC": [],');
    JsonList.Add('      "buses": [],');
    JsonList.Add('      "busEntries": [],');
    JsonList.Add('      "directives": [],');
    JsonList.Add('      "graphicPrimitives": [],');
    JsonList.Add('      "graphicsExtraction": {');
    JsonList.Add('        "symbolBodies": "pinBoundsFallback",');
    JsonList.Add('        "nativeSymbolPrimitives": "reservedNotExportedInCompatibilityBuild",');
    JsonList.Add('        "ports": "reserved",');
    JsonList.Add('        "powerPorts": "reserved",');
    JsonList.Add('        "offSheetConnectors": "reserved",');
    JsonList.Add('        "junctions": "reserved",');
    JsonList.Add('        "buses": "reserved",');
    JsonList.Add('        "notes": "V25 keeps the universal schema stable. Native SCH primitive extraction should be enabled object family by object family after API validation in the target Altium version."');
    JsonList.Add('      }');
    JsonList.Add('    }');

    AppendExportLog('Added schematic sheet v25: ' + FileName + ' components=' + IntToStr(CompCount) + ' wires=' + IntToStr(WireCount) + ' netLabels=' + IntToStr(NetCount));
end;

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
        AddExporterMetadata(JsonList);
        JsonList.Add('  "components": [');

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
    finally
        JsonList.Free;
    end;
end;

{==============================================================================}
{ 2. EXPORT ACTIVE PCB TO JSON (WITH SILKSCREEN, POLYGONS & MECHANICALS)       }
{==============================================================================}
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
        AddExporterMetadata(JsonList);

        AddPcbBoardOutlineJson(PcbBoard, JsonList);

        { Components }
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
            JsonList.Add('      "baseDesignator": "' + EscapeStr(BaseDesignatorOf(Component.Name.Text)) + '",');
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

        { Tracks: export all track objects from AllLayers. Avoid version-specific layer
          constants such as eMid1Layer/eMechanicalLayer1 that are not available in
          every Altium PascalScript environment. }
        JsonList.Add('  "tracks": [');
        Count := 0;
        Iterator := PcbBoard.BoardIterator_Create;
        Iterator.AddFilter_ObjectSet(MkSet(eTrackObject));
        Iterator.AddFilter_LayerSet(AllLayers);
        Iterator.AddFilter_Method(eProcessAll);
        Track := Iterator.FirstPCBObject;
        while Track <> nil do
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
            Track := Iterator.NextPCBObject;
        end;
        PcbBoard.BoardIterator_Destroy(Iterator);
        JsonList.Add('  ],');

        { Pads }
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
                begin
                JsonList.Add('      "component": "' + EscapeStr(Pad.Component.Name.Text) + '",');
                JsonList.Add('      "baseComponent": "' + EscapeStr(BaseDesignatorOf(Pad.Component.Name.Text)) + '",');
            end
            else
            begin
                JsonList.Add('      "component": "",');
                JsonList.Add('      "baseComponent": "",');
            end;
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

        { Vias }
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

        { Universal PCB extension arrays. They are intentionally schema-stable even when
          a given Altium API family is not safely accessible in this compatibility build. }
        JsonList.Add('  "arcs": [],');
        JsonList.Add('  "regions": [],');
        JsonList.Add('  "fills": [],');
        JsonList.Add('  "solidRegions": [],');
        JsonList.Add('  "copperRegions": [],');
        JsonList.Add('  "polygons": [],');
        JsonList.Add('  "polygonPours": [],');
        JsonList.Add('  "splitPlanes": [],');
        JsonList.Add('  "planeCutouts": [],');
        JsonList.Add('  "keepouts": [],');
        JsonList.Add('  "rooms": [],');
        JsonList.Add('  "dimensions": [],');
        JsonList.Add('  "texts": [],');
        JsonList.Add('  "pcbExtraction": {');
        JsonList.Add('    "components": "native",');
        JsonList.Add('    "pads": "native",');
        JsonList.Add('    "vias": "native",');
        JsonList.Add('    "tracks": "native",');
        JsonList.Add('    "boardOutline": "nativeBoardOutlineBoundingRectangleThenAllObjectFallback",');
        JsonList.Add('    "polygons": "reserved",');
        JsonList.Add('    "splitPlanes": "reserved",');
        JsonList.Add('    "regions": "reserved",');
        JsonList.Add('    "notes": "V25 uses the native Board.BoardOutline.BoundingRectangle when available. This validates Board Shape access and replaces the Mechanical Layer 1 bounding-box fallback. Full vertex/polyline outline extraction remains the next API-specific step."');
        JsonList.Add('  },');

        { Layer list used by the HTML viewer and comparison tools }
        JsonList.Add('  "layers": [');
        JsonList.Add('    "Top Layer",');
        JsonList.Add('    "Mid Layer 1", "Mid Layer 2", "Mid Layer 3", "Mid Layer 4", "Mid Layer 5",');
        JsonList.Add('    "Mid Layer 6", "Mid Layer 7", "Mid Layer 8", "Mid Layer 9", "Mid Layer 10",');
        JsonList.Add('    "Mid Layer 11", "Mid Layer 12", "Mid Layer 13", "Mid Layer 14", "Mid Layer 15",');
        JsonList.Add('    "Mid Layer 16", "Mid Layer 17", "Mid Layer 18", "Mid Layer 19", "Mid Layer 20",');
        JsonList.Add('    "Mid Layer 21", "Mid Layer 22", "Mid Layer 23", "Mid Layer 24", "Mid Layer 25",');
        JsonList.Add('    "Mid Layer 26", "Mid Layer 27", "Mid Layer 28", "Mid Layer 29", "Mid Layer 30",');
        JsonList.Add('    "Bottom Layer"');
        JsonList.Add('  ]');
        JsonList.Add('}');

        AppendExportLog('Saving PCB JSON: ' + FilePath);
        JsonList.SaveToFile(FilePath);
        AppendExportLog('Saved PCB JSON: ' + FilePath);
    finally
        JsonList.Free;
    end;
end;

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

procedure ExportAllProjectSchematicToSingleJson;
var
    Workspace  : IWorkSpace;
    Project    : IProject;
    Document   : IDocument;
    SchDoc     : ISch_Document;
    JsonList   : TStringList;
    FilePath   : String;
    i          : Integer;
    SheetCount : Integer;
    Ext        : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then Exit;

    Project := Workspace.DM_FocusedProject;
    if Project = nil then begin AppendExportLog('No focused project in ExportAllProjectSchematicToSingleJson'); Exit; end;

    FilePath := GetProjectPath + ChangeFileExt(ExtractFileName(Project.DM_ProjectFullPath), '_schematic.json');
    JsonList := TStringList.Create;
    try
        JsonList.Add('{');
        JsonList.Add('  "type": "schematic",');
        AddExporterMetadata(JsonList);
        JsonList.Add('  "schemaVersion": "v25",');
        JsonList.Add('  "exportGoal": "universalLogicalPlusGraphicsFallbackV25",');
        JsonList.Add('  "project": "' + EscapeStr(ChangeFileExt(ExtractFileName(Project.DM_ProjectFullPath), '')) + '",');
        JsonList.Add('  "sheets": [');

        SheetCount := 0;
        AppendExportLog('SCH logical document count: ' + IntToStr(Project.DM_LogicalDocumentCount));
        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));

            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    if SheetCount > 0 then JsonList.Add('    ,');
                    AddSchDocToSchematicJson(JsonList, SchDoc, Document.DM_FullPath, SheetCount);
                    Inc(SheetCount);
                end
                else
                    AppendExportLog('Unable to load SCH document: ' + Document.DM_FullPath);
            end;
        end;

        JsonList.Add('  ]');
        JsonList.Add('}');

        AppendExportLog('Saving single schematic JSON: ' + FilePath + ' sheetCount=' + IntToStr(SheetCount));
        JsonList.SaveToFile(FilePath);
        AppendExportLog('Saved single schematic JSON: ' + FilePath);
    finally
        JsonList.Free;
    end;
end;

procedure ExportAllProjectSchToJson;
begin
    ExportAllProjectSchematicToSingleJson;
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

{==============================================================================}
{ 3. EXPORT PROJECT BILL OF MATERIALS (BOM) TO JSON                            }
{==============================================================================}
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
    WrittenKeys : TStringList;
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
        AddExporterMetadata(JsonList);
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
                            WrittenKeys := TStringList.Create;
                            try
                                ParamIter := Component.SchIterator_Create;
                                ParamIter.AddFilter_ObjectSet(MkSet(eParameter));
                                Parameter := ParamIter.FirstSchObject;
                                while Parameter <> nil do
                                begin
                                    if (Parameter.Name <> 'Designator') and
                                       (Parameter.Name <> 'Comment') and
                                       (Parameter.Name <> '') and
                                       (not JsonKeyAlreadyWritten(WrittenKeys, Parameter.Name)) then
                                    begin
                                        if ParamCount > 0 then JsonList.Add('        ,');
                                        JsonList.Add('        "' + EscapeStr(Parameter.Name) + '": "' + EscapeStr(Parameter.Text) + '"');
                                        Inc(ParamCount);
                                    end;
                                    Parameter := ParamIter.NextSchObject;
                                end;
                                Component.SchIterator_Destroy(ParamIter);
                            finally
                                WrittenKeys.Free;
                            end;

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

{==============================================================================}
{ 4. OUTJOB REQUIRED ENTRIES                                                   }
{==============================================================================}

function Configure(Parameters : String) : String;
begin
    InitializeOutputContext(Parameters);
    Result := Parameters;
end;

function BuildPredictedOutputFileNames : String;
var
    OutputFileNames : TStringList;
begin
    InitializeOutputContext('');

    OutputFileNames := TStringList.Create;
    OutputFileNames.Delimiter := '|';
    OutputFileNames.StrictDelimiter := True;
    try
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_bom.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_pcb.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_schematic.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + 'export_probe.json');
        OutputFileNames.Add(GetProjectPath + TargetPrefix + 'export_design_data_debug.txt');
        Result := OutputFileNames.DelimitedText;
    finally
        OutputFileNames.Free;
    end;
end;

// Signature attendue par certaines versions/configurations OutJob Altium.
function PredictOutputFileName : String;
begin
    Result := BuildPredictedOutputFileNames;
end;

// Variante plurielle conservée pour compatibilité avec les scripts OutJob qui l'appellent.
function PredictOutputFileNames : String;
begin
    Result := BuildPredictedOutputFileNames;
end;

// Variante avec paramètre conservée pour compatibilité avec d'autres templates OutJob.
function PredictOutputFileNames(Parameters : String) : String;
begin
    InitializeOutputContext(Parameters);
    Result := BuildPredictedOutputFileNames;
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