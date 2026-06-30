{==============================================================================}
{ Altium Diff Studio - Exporter Script v58                                           }
{                                                                              }
{ This DelphiScript module exports Schematic sheets, PCB layouts, copper/plane placeholders, and project  }
{ BOM data from Altium Designer to lightweight JSON files compatible with      }
{ Altium Diff Studio.                                                          }
{==============================================================================}

const
    SCRIPT_VERSION = 'v58';
    SCHEMA_VERSION = 'ads-json-v58';
    SCHEMATIC_SCHEMA_VERSION = 'v58';
    PCB_OUTPUT_SUFFIX = '_pcb.json';
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
        else if C = '"' then Result := Result + '\"'
        else if C = #13 then Result := Result + '\r'
        else if C = #10 then Result := Result + '\n'
        else if C = #9 then Result := Result + '\t'
        else if (Code < 32) or (Code > 126) then Result := Result + '\u' + Hex4(Code)
        else Result := Result + C;
    end;
end;


{ V52b: typed, compile-visible helpers for component display text geometry.
  The access stays narrow: only ISch_Component.Designator / Comment fields are used.
  If Altium does not expose a display-object geometry property at runtime, the
  function falls back to the component origin so the export remains usable. }
function TryCompDesignatorX(Component : ISch_Component; FallbackX : Integer) : Integer;
begin
    Result := FallbackX;
    try
        Result := Component.Designator.Location.X;
    except
        Result := FallbackX;
    end;
end;

function TryCompDesignatorY(Component : ISch_Component; FallbackY : Integer) : Integer;
begin
    Result := FallbackY;
    try
        Result := Component.Designator.Location.Y;
    except
        Result := FallbackY;
    end;
end;

function TryCompDesignatorOrientation(Component : ISch_Component) : Integer;
begin
    Result := 0;
    try
        Result := Component.Designator.Orientation;
    except
        Result := 0;
    end;
end;

function TryCompCommentX(Component : ISch_Component; FallbackX : Integer) : Integer;
begin
    Result := FallbackX;
    try
        Result := Component.Comment.Location.X;
    except
        Result := FallbackX;
    end;
end;

function TryCompCommentY(Component : ISch_Component; FallbackY : Integer) : Integer;
begin
    Result := FallbackY;
    try
        Result := Component.Comment.Location.Y;
    except
        Result := FallbackY;
    end;
end;

function TryCompCommentOrientation(Component : ISch_Component) : Integer;
begin
    Result := 0;
    try
        Result := Component.Comment.Orientation;
    except
        Result := 0;
    end;
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

function NormalizeAngleDeg(A : Double) : Double;
begin
    Result := A;
    while Result < 0 do
        Result := Result + 360;
    while Result >= 360 do
        Result := Result - 360;
end;

function AngleInArcSweep(TestAngle : Double; StartAngle : Double; EndAngle : Double) : Boolean;
var
    T : Double;
    S : Double;
    E : Double;
begin
    T := NormalizeAngleDeg(TestAngle);
    S := NormalizeAngleDeg(StartAngle);
    E := NormalizeAngleDeg(EndAngle);

    { Altium keepout arcs exported here are rendered as the counter-clockwise sweep
      from StartAngle to EndAngle, with wrap handled explicitly. If Start and End
      are identical, treat it as a full circle to avoid losing real circular arcs. }
    if Abs(S - E) < 0.0001 then
    begin
        Result := True;
        Exit;
    end;

    if S < E then
        Result := (T >= S) and (T <= E)
    else
        Result := (T >= S) or (T <= E);
end;

procedure IncludeArcAnglePoint(var HasBounds : Boolean; var MinX : Double; var MinY : Double; var MaxX : Double; var MaxY : Double; CX : Double; CY : Double; R : Double; A : Double);
var
    Rad : Double;
begin
    Rad := NormalizeAngleDeg(A) * 3.14159265358979323846 / 180.0;
    IncludeBoundsPoint(HasBounds, MinX, MinY, MaxX, MaxY, CX + R * Cos(Rad), CY + R * Sin(Rad));
end;

procedure IncludeArcSweepBounds(var HasBounds : Boolean; var MinX : Double; var MinY : Double; var MaxX : Double; var MaxY : Double; CX : Double; CY : Double; R : Double; StartAngle : Double; EndAngle : Double);
begin
    { Always include arc endpoints. Then include the cardinal extrema only if they
      lie on the actual swept arc. This prevents a small arc from expanding the
      viewer bounds to the complete circle. }
    IncludeArcAnglePoint(HasBounds, MinX, MinY, MaxX, MaxY, CX, CY, R, StartAngle);
    IncludeArcAnglePoint(HasBounds, MinX, MinY, MaxX, MaxY, CX, CY, R, EndAngle);

    if AngleInArcSweep(0, StartAngle, EndAngle) then
        IncludeArcAnglePoint(HasBounds, MinX, MinY, MaxX, MaxY, CX, CY, R, 0);
    if AngleInArcSweep(90, StartAngle, EndAngle) then
        IncludeArcAnglePoint(HasBounds, MinX, MinY, MaxX, MaxY, CX, CY, R, 90);
    if AngleInArcSweep(180, StartAngle, EndAngle) then
        IncludeArcAnglePoint(HasBounds, MinX, MinY, MaxX, MaxY, CX, CY, R, 180);
    if AngleInArcSweep(270, StartAngle, EndAngle) then
        IncludeArcAnglePoint(HasBounds, MinX, MinY, MaxX, MaxY, CX, CY, R, 270);
end;

procedure AddPcbBoardOutlineJson(PcbBoard : IPCB_Board; JsonList : TStringList);
var
    Iterator       : IPCB_Iterator;
    Component      : IPCB_Component;
    Track          : IPCB_Track;
    Arc            : IPCB_Arc;
    Pad            : IPCB_Pad;
    Via            : IPCB_Via;
    HasBounds      : Boolean;
    MinX           : Double;
    MinY           : Double;
    MaxX           : Double;
    MaxY           : Double;
    Margin         : Double;
    OutlineSource  : String;
    EdgeCount      : Integer;
    OutlineEdgeCount : Integer;
    OutlineCandidateCount : Integer;
    KeepoutCandidateCount : Integer;
    ArcCandidateCount : Integer;
    HasKeepoutBounds : Boolean;
    KeepoutMinX    : Double;
    KeepoutMinY    : Double;
    KeepoutMaxX    : Double;
    KeepoutMaxY    : Double;
    HasCandidateBounds : Boolean;
    CandidateMinX  : Double;
    CandidateMinY  : Double;
    CandidateMaxX  : Double;
    CandidateMaxY  : Double;
    TrackClass     : String;
    LayerName      : String;
    X1mm           : Double;
    Y1mm           : Double;
    X2mm           : Double;
    Y2mm           : Double;
    Tol            : Double;
    OnLeft1        : Boolean;
    OnRight1       : Boolean;
    OnBottom1      : Boolean;
    OnTop1         : Boolean;
    OnLeft2        : Boolean;
    OnRight2       : Boolean;
    OnBottom2      : Boolean;
    OnTop2         : Boolean;
    EdgeCandidate  : Boolean;
    CXmm           : Double;
    CYmm           : Double;
    Rmm            : Double;
begin
    HasBounds := False;
    MinX := 0;
    MinY := 0;
    MaxX := 0;
    MaxY := 0;
    OutlineSource := 'none';
    HasKeepoutBounds := False;
    KeepoutMinX := 0;
    KeepoutMinY := 0;
    KeepoutMaxX := 0;
    KeepoutMaxY := 0;
    HasCandidateBounds := False;
    CandidateMinX := 0;
    CandidateMinY := 0;
    CandidateMaxX := 0;
    CandidateMaxY := 0;

    { V31 outline strategy:
      1) Keep the validated native BoardOutline.BoundingRectangle path.
      2) Do not call unvalidated vertex methods: previous tests showed that the
         common names are not compile-compatible with this Altium installation.
      3) Export KeepOutLayer tracks/arcs in the same spirit as InteractiveHTMLBOM.
      4) Add render bounds derived from boardOutlineCandidate edges so viewers zoom
         to the real card area even when older fallback boardOutline rectangles exist.
      5) V31 fixes arc bounds: arcs contribute only their real swept start/end/cardinal
         extrema instead of the full circle bounding box. }

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

    { V28: InteractiveHTMLBOM-compatible outline extraction.
      InteractiveHTMLBOM reads eTrackObject + eArcObject from eKeepOutLayer to
      draw a clean visual board outline. We keep the native BoardOutline rectangle
      for bounds, and add these explicit drawable edges for the HTML viewer. }
    JsonList.Add('  "boardOutlineEdges": [');
    OutlineEdgeCount := 0;
    OutlineCandidateCount := 0;
    KeepoutCandidateCount := 0;
    ArcCandidateCount := 0;

    Iterator := PcbBoard.BoardIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eTrackObject));
    Iterator.AddFilter_LayerSet(MkSet(eKeepOutLayer));
    Iterator.AddFilter_Method(eProcessAll);
    Track := Iterator.FirstPCBObject;
    while Track <> nil do
    begin
        if CoordToMMs(Track.Width) <= 1.1 then
        begin
            TrackClass := 'boardOutlineCandidate';
            Inc(OutlineCandidateCount);
        end
        else
        begin
            TrackClass := 'localKeepoutOrCutoutCandidate';
            Inc(KeepoutCandidateCount);
        end;

        X1mm := CoordToMMs(Track.X1);
        Y1mm := CoordToMMs(Track.Y1);
        X2mm := CoordToMMs(Track.X2);
        Y2mm := CoordToMMs(Track.Y2);
        IncludeBoundsPoint(HasKeepoutBounds, KeepoutMinX, KeepoutMinY, KeepoutMaxX, KeepoutMaxY, X1mm, Y1mm);
        IncludeBoundsPoint(HasKeepoutBounds, KeepoutMinX, KeepoutMinY, KeepoutMaxX, KeepoutMaxY, X2mm, Y2mm);
        if TrackClass = 'boardOutlineCandidate' then
        begin
            IncludeBoundsPoint(HasCandidateBounds, CandidateMinX, CandidateMinY, CandidateMaxX, CandidateMaxY, X1mm, Y1mm);
            IncludeBoundsPoint(HasCandidateBounds, CandidateMinX, CandidateMinY, CandidateMaxX, CandidateMaxY, X2mm, Y2mm);
        end;


        if OutlineEdgeCount > 0 then JsonList.Add('    ,');
        JsonList.Add('    {');
        JsonList.Add('      "id": "OUTLINE_EDGE_' + IntToStr(OutlineEdgeCount) + '",');
        JsonList.Add('      "type": "segment",');
        JsonList.Add('      "source": "keepoutLayerTrack",');
        JsonList.Add('      "edgeClass": "' + TrackClass + '",');
        JsonList.Add('      "layer": "' + EscapeStr(Layer2String(Track.Layer)) + '",');
        JsonList.Add('      "start": { "x": ' + JsonFloat(X1mm) + ', "y": ' + JsonFloat(Y1mm) + ' },');
        JsonList.Add('      "end": { "x": ' + JsonFloat(X2mm) + ', "y": ' + JsonFloat(Y2mm) + ' },');
        JsonList.Add('      "width": ' + JsonFloat(CoordToMMs(Track.Width)));
        JsonList.Add('    }');
        Inc(OutlineEdgeCount);
        Track := Iterator.NextPCBObject;
    end;
    PcbBoard.BoardIterator_Destroy(Iterator);

    Iterator := PcbBoard.BoardIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eArcObject));
    Iterator.AddFilter_LayerSet(MkSet(eKeepOutLayer));
    Iterator.AddFilter_Method(eProcessAll);
    Arc := Iterator.FirstPCBObject;
    while Arc <> nil do
    begin
        Inc(ArcCandidateCount);
        if CoordToMMs(Arc.LineWidth) <= 1.1 then
        begin
            TrackClass := 'boardOutlineCandidate';
            Inc(OutlineCandidateCount);
        end
        else
        begin
            TrackClass := 'localKeepoutOrCutoutCandidate';
            Inc(KeepoutCandidateCount);
        end;

        CXmm := CoordToMMs(Arc.XCenter);
        CYmm := CoordToMMs(Arc.YCenter);
        Rmm := CoordToMMs(Arc.Radius);

        { V31: use true swept arc bounds, not full-circle bounds. }
        IncludeArcSweepBounds(HasKeepoutBounds, KeepoutMinX, KeepoutMinY, KeepoutMaxX, KeepoutMaxY, CXmm, CYmm, Rmm, Arc.StartAngle, Arc.EndAngle);
        if TrackClass = 'boardOutlineCandidate' then
            IncludeArcSweepBounds(HasCandidateBounds, CandidateMinX, CandidateMinY, CandidateMaxX, CandidateMaxY, CXmm, CYmm, Rmm, Arc.StartAngle, Arc.EndAngle);

        if OutlineEdgeCount > 0 then JsonList.Add('    ,');
        JsonList.Add('    {');
        JsonList.Add('      "id": "OUTLINE_EDGE_' + IntToStr(OutlineEdgeCount) + '",');
        JsonList.Add('      "type": "arc",');
        JsonList.Add('      "source": "keepoutLayerArc",');
        JsonList.Add('      "edgeClass": "' + TrackClass + '",');
        JsonList.Add('      "layer": "' + EscapeStr(Layer2String(Arc.Layer)) + '",');
        JsonList.Add('      "center": { "x": ' + JsonFloat(CXmm) + ', "y": ' + JsonFloat(CYmm) + ' },');
        JsonList.Add('      "radius": ' + JsonFloat(Rmm) + ',');
        JsonList.Add('      "startAngle": ' + JsonFloat(Arc.StartAngle) + ',');
        JsonList.Add('      "endAngle": ' + JsonFloat(Arc.EndAngle) + ',');
        JsonList.Add('      "width": ' + JsonFloat(CoordToMMs(Arc.LineWidth)));
        JsonList.Add('    }');
        Inc(OutlineEdgeCount);
        Arc := Iterator.NextPCBObject;
    end;
    PcbBoard.BoardIterator_Destroy(Iterator);
    JsonList.Add('  ],');
    JsonList.Add('  "boardOutlineEdgesSource": "keepOutLayerTracksAndArcs_InteractiveHTMLBOMStyle",');
    JsonList.Add('  "boardOutlineEdgesCount": ' + IntToStr(OutlineEdgeCount) + ',');
    JsonList.Add('  "boardOutlineClassification": {');
    JsonList.Add('    "method": "widthHeuristicV31_arcAwareBounds",');
    JsonList.Add('    "boardOutlineCandidateCount": ' + IntToStr(OutlineCandidateCount) + ',');
    JsonList.Add('    "localKeepoutOrCutoutCandidateCount": ' + IntToStr(KeepoutCandidateCount) + ',');
    JsonList.Add('    "arcCandidateCount": ' + IntToStr(ArcCandidateCount) + ',');
    JsonList.Add('    "notes": "V33e tags each keepout edge and exports arc-aware viewer-ready render bounds. width <= 1.1mm is treated as boardOutlineCandidate; wider edges are kept as localKeepoutOrCutoutCandidate. Arc bounds now use the swept arc endpoints and cardinal extrema only when they lie inside the arc sweep."');
    JsonList.Add('  },');
    JsonList.Add('  "boardOutlineRenderBounds": {');
    if HasCandidateBounds then
    begin
        JsonList.Add('    "source": "boardOutlineCandidateEdges",');
        JsonList.Add('    "minX": ' + JsonFloat(CandidateMinX) + ',');
        JsonList.Add('    "minY": ' + JsonFloat(CandidateMinY) + ',');
        JsonList.Add('    "maxX": ' + JsonFloat(CandidateMaxX) + ',');
        JsonList.Add('    "maxY": ' + JsonFloat(CandidateMaxY));
    end
    else if HasKeepoutBounds then
    begin
        JsonList.Add('    "source": "allKeepoutEdges",');
        JsonList.Add('    "minX": ' + JsonFloat(KeepoutMinX) + ',');
        JsonList.Add('    "minY": ' + JsonFloat(KeepoutMinY) + ',');
        JsonList.Add('    "maxX": ' + JsonFloat(KeepoutMaxX) + ',');
        JsonList.Add('    "maxY": ' + JsonFloat(KeepoutMaxY));
    end
    else
    begin
        JsonList.Add('    "source": "nativeBoardOutlineBoundingRectangle",');
        JsonList.Add('    "minX": ' + JsonFloat(MinX) + ',');
        JsonList.Add('    "minY": ' + JsonFloat(MinY) + ',');
        JsonList.Add('    "maxX": ' + JsonFloat(MaxX) + ',');
        JsonList.Add('    "maxY": ' + JsonFloat(MaxY));
    end;
    JsonList.Add('  },');
    JsonList.Add('  "viewerHints": {');
    JsonList.Add('    "preferredOutline": "boardOutlineEdges where edgeClass=boardOutlineCandidate",');
    JsonList.Add('    "preferredBounds": "boardOutlineRenderBounds",');
    JsonList.Add('    "fallbackOutline": "boardOutline",');
    JsonList.Add('    "units": "mm",');
    JsonList.Add('    "yAxis": "Altium PCB coordinates; viewer may invert for screen display"');
    JsonList.Add('  },');

    { Diagnostic helper for the next step. This does not replace the native outline;
      it exports only mechanical track segments whose endpoints sit on one of the
      native rectangle edges. If the real board outline is drawn as mechanical tracks,
      this array should reveal the relevant layer and exact segment geometry. }
    JsonList.Add('  "boardOutlineDiagnostics": {');
    JsonList.Add('    "nativeBoundingRectangle": {');
    JsonList.Add('      "minX": ' + JsonFloat(MinX) + ',');
    JsonList.Add('      "minY": ' + JsonFloat(MinY) + ',');
    JsonList.Add('      "maxX": ' + JsonFloat(MaxX) + ',');
    JsonList.Add('      "maxY": ' + JsonFloat(MaxY));
    JsonList.Add('    },');
    JsonList.Add('    "mechanicalEdgeSegments": [');

    EdgeCount := 0;
    Tol := 0.05; { mm }
    Iterator := PcbBoard.BoardIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eTrackObject));
    Iterator.AddFilter_LayerSet(AllLayers);
    Iterator.AddFilter_Method(eProcessAll);
    Track := Iterator.FirstPCBObject;
    while Track <> nil do
    begin
        LayerName := Layer2String(Track.Layer);
        if Pos('Mechanical Layer', LayerName) > 0 then
        begin
            X1mm := CoordToMMs(Track.X1);
            Y1mm := CoordToMMs(Track.Y1);
            X2mm := CoordToMMs(Track.X2);
            Y2mm := CoordToMMs(Track.Y2);

            OnLeft1 := Abs(X1mm - MinX) <= Tol;
            OnRight1 := Abs(X1mm - MaxX) <= Tol;
            OnBottom1 := Abs(Y1mm - MinY) <= Tol;
            OnTop1 := Abs(Y1mm - MaxY) <= Tol;
            OnLeft2 := Abs(X2mm - MinX) <= Tol;
            OnRight2 := Abs(X2mm - MaxX) <= Tol;
            OnBottom2 := Abs(Y2mm - MinY) <= Tol;
            OnTop2 := Abs(Y2mm - MaxY) <= Tol;

            EdgeCandidate := ((OnLeft1 and OnLeft2) or (OnRight1 and OnRight2) or
                              (OnBottom1 and OnBottom2) or (OnTop1 and OnTop2));

            if EdgeCandidate then
            begin
                if EdgeCount > 0 then JsonList.Add('      ,');
                JsonList.Add('      {');
                JsonList.Add('        "id": "MECH_EDGE_' + IntToStr(EdgeCount) + '",');
                JsonList.Add('        "layer": "' + EscapeStr(LayerName) + '",');
                JsonList.Add('        "start": { "x": ' + JsonFloat(X1mm) + ', "y": ' + JsonFloat(Y1mm) + ' },');
                JsonList.Add('        "end": { "x": ' + JsonFloat(X2mm) + ', "y": ' + JsonFloat(Y2mm) + ' },');
                JsonList.Add('        "width": ' + JsonFloat(CoordToMMs(Track.Width)));
                JsonList.Add('      }');
                Inc(EdgeCount);
            end;
        end;
        Track := Iterator.NextPCBObject;
    end;
    PcbBoard.BoardIterator_Destroy(Iterator);

    JsonList.Add('    ],');
    JsonList.Add('    "mechanicalEdgeSegmentCount": ' + IntToStr(EdgeCount) + ',');
    JsonList.Add('    "diagnosticNotes": "V28 keeps the safe native bounding rectangle and exports mechanical edge candidates near that rectangle. Use this to identify whether the true outline can be reconstructed from mechanical primitives while the BoardOutline vertex API remains unknown."');
    JsonList.Add('  },');
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
    JsonList.Add('    "scriptVersion": "' + SCRIPT_VERSION + '",');
    JsonList.Add('    "schemaVersion": "' + SCHEMA_VERSION + '"');
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
    PortObj     : ISch_Port;
    PowerObj    : ISch_PowerObject;
    JunctionObj : Variant;
    NoERCObj    : Variant;
    BusObj      : Variant;
    BusEntryObj : Variant;
    DirectiveObj : Variant;
    OffSheetObj : Variant;
    SheetSymbolObj : Variant;
    SheetEntryObj : Variant;
    FileName    : String;
    CompCount   : Integer;
    WireCount   : Integer;
    NetCount    : Integer;
    PortCount   : Integer;
    PowerCount  : Integer;
    JunctionCount : Integer;
    NoERCCount  : Integer;
    BusCount    : Integer;
    BusEntryCount : Integer;
    DirectiveCount : Integer;
    OffSheetCount : Integer;
    SheetSymbolCount : Integer;
    SheetEntryCount : Integer;
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
    JsonList.Add('      "schematicExportLevel": "logicalPlusTextRenderAndTypedBatchASymbolProbeV58",');
    JsonList.Add('      "graphicsNotes": "V58 keeps validated textRender and accelerates native symbol discovery with a compile-safe typed batch-A matrix for ObjectId 44/4/25: component context, LibRef grouping, fallback scoring, and typed-interface candidate batches. Symbol bodies still use pin-bounds fallback in the JSON until one typed primitive interface is validated.",');
    JsonList.Add('      "schemaUpgrade": {');
    JsonList.Add('        "version": "v58",');
    JsonList.Add('        "focus": "viewer-ready component text rendering plus compile-safe typed-typed batch-A matrix for native symbol discovery",');
    JsonList.Add('        "compatibilityMode": "safeNoNewSchObjectEnums"');
    JsonList.Add('      },');
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
        JsonList.Add('          "displayObjects": {');
        JsonList.Add('            "designator": { "objectId": 45, "role": "designatorDisplayObject", "text": "' + EscapeStr(Component.Designator.Text) + '", "x": ' + IntToStr(TryCompDesignatorX(Component, Component.Location.X)) + ', "y": ' + IntToStr(TryCompDesignatorY(Component, Component.Location.Y)) + ', "orientation": ' + IntToStr(TryCompDesignatorOrientation(Component)) + ', "geometrySource": "ISch_Component.Designator.Location", "source": "v58TypedComponentTextRender" },');
        JsonList.Add('            "comment": { "objectId": 46, "role": "commentDisplayObject", "text": "' + EscapeStr(Component.Comment.Text) + '", "x": ' + IntToStr(TryCompCommentX(Component, Component.Location.X)) + ', "y": ' + IntToStr(TryCompCommentY(Component, Component.Location.Y)) + ', "orientation": ' + IntToStr(TryCompCommentOrientation(Component)) + ', "geometrySource": "ISch_Component.Comment.Location", "source": "v58TypedComponentTextRender" },');
        JsonList.Add('            "primary": { "objectId": 25, "role": "primaryDisplayObjectCandidate", "text": "' + EscapeStr(Component.Designator.Text) + '", "x": ' + IntToStr(TryCompDesignatorX(Component, Component.Location.X)) + ', "y": ' + IntToStr(TryCompDesignatorY(Component, Component.Location.Y)) + ', "orientation": ' + IntToStr(TryCompDesignatorOrientation(Component)) + ', "geometrySource": "primaryUsesDesignatorGeometryCandidate", "source": "v58CandidateTextRender" }');
        JsonList.Add('          },');
        JsonList.Add('          "textRender": [');
        JsonList.Add('            { "type": "text", "role": "designator", "objectId": 45, "text": "' + EscapeStr(Component.Designator.Text) + '", "x": ' + IntToStr(TryCompDesignatorX(Component, Component.Location.X)) + ', "y": ' + IntToStr(TryCompDesignatorY(Component, Component.Location.Y)) + ', "orientation": ' + IntToStr(TryCompDesignatorOrientation(Component)) + ', "anchor": "location", "source": "ISch_Component.Designator.Location", "viewerHint": "componentDesignator" },');
        JsonList.Add('            { "type": "text", "role": "comment", "objectId": 46, "text": "' + EscapeStr(Component.Comment.Text) + '", "x": ' + IntToStr(TryCompCommentX(Component, Component.Location.X)) + ', "y": ' + IntToStr(TryCompCommentY(Component, Component.Location.Y)) + ', "orientation": ' + IntToStr(TryCompCommentOrientation(Component)) + ', "anchor": "location", "source": "ISch_Component.Comment.Location", "viewerHint": "componentComment" }');
        JsonList.Add('          ],');
        JsonList.Add('          "viewerRenderHints": { "componentTextSource": "textRender", "symbolBodySource": "symbolGraphics", "symbolBodyStatus": "pinBoundsFallbackUntilNativePrimitives" },');
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

    JsonList.Add('      "ports": [');
    PortCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(ePort));
    PortObj := Iterator.FirstSchObject;
    while PortObj <> nil do
    begin
        if PortCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_PORT_' + IntToStr(PortCount) + '",');
        JsonList.Add('          "text": "' + EscapeStr(PortObj.Name) + '",');
        JsonList.Add('          "x": ' + IntToStr(PortObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(PortObj.Location.Y));
        JsonList.Add('        }');
        Inc(PortCount);
        PortObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "powerPorts": [');
    PowerCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(ePowerObject));
    PowerObj := Iterator.FirstSchObject;
    while PowerObj <> nil do
    begin
        if PowerCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_POWER_' + IntToStr(PowerCount) + '",');
        JsonList.Add('          "text": "' + EscapeStr(PowerObj.Text) + '",');
        JsonList.Add('          "textSource": "ISch_PowerObject.Text",');
        JsonList.Add('          "x": ' + IntToStr(PowerObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(PowerObj.Location.Y));
        JsonList.Add('        }');
        Inc(PowerCount);
        PowerObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "offSheetConnectors": [');
    OffSheetCount := 0;
    { V41 compatibility fix:
      eOffSheetConnector is not declared in this target Altium scripting API.
      Keep the JSON container stable and leave native off-sheet extraction disabled
      until the exact enum name is identified for this Altium version. }
    JsonList.Add('      ],');

    JsonList.Add('      "sheetSymbols": [');
    SheetSymbolCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eSheetSymbol));
    SheetSymbolObj := Iterator.FirstSchObject;
    while SheetSymbolObj <> nil do
    begin
        if SheetSymbolCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_SHEETSYMBOL_' + IntToStr(SheetSymbolCount) + '",');
        JsonList.Add('          "source": "eSheetSymbol",');
        JsonList.Add('          "name": "",');
        JsonList.Add('          "fileName": "",');
        JsonList.Add('          "metadataStatus": "nameAndFileNameUnavailableInTargetApi",');
        JsonList.Add('          "x": ' + IntToStr(SheetSymbolObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(SheetSymbolObj.Location.Y));
        JsonList.Add('        }');
        Inc(SheetSymbolCount);
        SheetSymbolObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "sheetEntries": [');
    SheetEntryCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eSheetEntry));
    SheetEntryObj := Iterator.FirstSchObject;
    while SheetEntryObj <> nil do
    begin
        if SheetEntryCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_SHEETENTRY_' + IntToStr(SheetEntryCount) + '",');
        JsonList.Add('          "source": "eSheetEntry",');
        JsonList.Add('          "name": "",');
        JsonList.Add('          "metadataStatus": "nameUnavailableInTargetApi",');
        JsonList.Add('          "x": ' + IntToStr(SheetEntryObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(SheetEntryObj.Location.Y));
        JsonList.Add('        }');
        Inc(SheetEntryCount);
        SheetEntryObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "hierarchyAnchors": {');
    JsonList.Add('        "version": "v42",');
    JsonList.Add('        "source": "nativeSheetSymbolsAndSheetEntriesLocations",');
    JsonList.Add('        "sheetSymbols": [');
    SheetSymbolCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eSheetSymbol));
    SheetSymbolObj := Iterator.FirstSchObject;
    while SheetSymbolObj <> nil do
    begin
        if SheetSymbolCount > 0 then JsonList.Add('          ,');
        JsonList.Add('          {');
        JsonList.Add('            "id": "SHEET_' + IntToStr(SheetIndex) + '_SHEETSYMBOL_' + IntToStr(SheetSymbolCount) + '",');
        JsonList.Add('            "parentSheetId": "SHEET_' + IntToStr(SheetIndex) + '",');
        JsonList.Add('            "anchorType": "sheetSymbol",');
        JsonList.Add('            "x": ' + IntToStr(SheetSymbolObj.Location.X) + ',');
        JsonList.Add('            "y": ' + IntToStr(SheetSymbolObj.Location.Y) + ',');
        JsonList.Add('            "metadataStatus": "nameAndFileNameUnavailableInTargetApi",');
        JsonList.Add('            "viewerRole": "candidateChildSheetContainer"');
        JsonList.Add('          }');
        Inc(SheetSymbolCount);
        SheetSymbolObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('        ],');
    JsonList.Add('        "sheetEntries": [');
    SheetEntryCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eSheetEntry));
    SheetEntryObj := Iterator.FirstSchObject;
    while SheetEntryObj <> nil do
    begin
        if SheetEntryCount > 0 then JsonList.Add('          ,');
        JsonList.Add('          {');
        JsonList.Add('            "id": "SHEET_' + IntToStr(SheetIndex) + '_SHEETENTRY_' + IntToStr(SheetEntryCount) + '",');
        JsonList.Add('            "parentSheetId": "SHEET_' + IntToStr(SheetIndex) + '",');
        JsonList.Add('            "anchorType": "sheetEntry",');
        JsonList.Add('            "x": ' + IntToStr(SheetEntryObj.Location.X) + ',');
        JsonList.Add('            "y": ' + IntToStr(SheetEntryObj.Location.Y) + ',');
        JsonList.Add('            "metadataStatus": "nameUnavailableInTargetApi",');
        JsonList.Add('            "viewerRole": "candidateInterSheetNetEndpoint"');
        JsonList.Add('          }');
        Inc(SheetEntryCount);
        SheetEntryObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('        ],');
    JsonList.Add('        "resolutionHints": {');
    JsonList.Add('          "primary": "groupSheetEntriesByNearestSheetSymbolOnSameParentSheet",');
    JsonList.Add('          "secondary": "matchSheetEntriesToChildPortsByNameWhenNamesBecomeAvailable",');
    JsonList.Add('          "fallback": "useCoordinateProximityAndAttachedWireTopology"');
    JsonList.Add('        }');
    JsonList.Add('      },');

    JsonList.Add('      "junctions": [');
    JunctionCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eJunction));
    JunctionObj := Iterator.FirstSchObject;
    while JunctionObj <> nil do
    begin
        if JunctionCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_JUNCTION_' + IntToStr(JunctionCount) + '",');
        JsonList.Add('          "x": ' + IntToStr(JunctionObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(JunctionObj.Location.Y));
        JsonList.Add('        }');
        Inc(JunctionCount);
        JunctionObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');
    JsonList.Add('      "junctionTopologyFallback": {');
    JsonList.Add('        "nativeJunctionCount": ' + IntToStr(JunctionCount) + ',');
    JsonList.Add('        "status": "viewerShouldInferWhenNativeCountIsZero",');
    JsonList.Add('        "source": "wireTopology",');
    JsonList.Add('        "rule": "Infer visible junction dots at coordinates where three or more wire/pin/port endpoints or segment intersections meet, and at T-junctions between orthogonal wire segments.",');
    JsonList.Add('        "notes": "V42 keeps the native eJunction pass, but adds an explicit fallback contract because this Altium version returned zero native junction objects on the AGMA project."');
    JsonList.Add('      },');

    JsonList.Add('      "noERC": [');
    NoERCCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eNoERC));
    NoERCObj := Iterator.FirstSchObject;
    while NoERCObj <> nil do
    begin
        if NoERCCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_NOERC_' + IntToStr(NoERCCount) + '",');
        JsonList.Add('          "x": ' + IntToStr(NoERCObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(NoERCObj.Location.Y));
        JsonList.Add('        }');
        Inc(NoERCCount);
        NoERCObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "buses": [');
    BusCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eBus));
    BusObj := Iterator.FirstSchObject;
    while BusObj <> nil do
    begin
        if BusCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_BUS_' + IntToStr(BusCount) + '",');
        JsonList.Add('          "points": [');
        for VertexIndex := 1 to BusObj.VerticesCount do
        begin
            ALocation := BusObj.GetState_Vertex(VertexIndex);
            if VertexIndex > 1 then JsonList.Add('            ,');
            JsonList.Add('            { "x": ' + IntToStr(ALocation.X) + ', "y": ' + IntToStr(ALocation.Y) + ' }');
        end;
        JsonList.Add('          ]');
        JsonList.Add('        }');
        Inc(BusCount);
        BusObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "busEntries": [');
    BusEntryCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eBusEntry));
    BusEntryObj := Iterator.FirstSchObject;
    while BusEntryObj <> nil do
    begin
        if BusEntryCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_BUSENTRY_' + IntToStr(BusEntryCount) + '",');
        JsonList.Add('          "x": ' + IntToStr(BusEntryObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(BusEntryObj.Location.Y));
        JsonList.Add('        }');
        Inc(BusEntryCount);
        BusEntryObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');

    JsonList.Add('      "directives": [');
    DirectiveCount := 0;
    Iterator := SchDoc.SchIterator_Create;
    Iterator.AddFilter_ObjectSet(MkSet(eParameterSet));
    DirectiveObj := Iterator.FirstSchObject;
    while DirectiveObj <> nil do
    begin
        if DirectiveCount > 0 then JsonList.Add('        ,');
        JsonList.Add('        {');
        JsonList.Add('          "id": "SHEET_' + IntToStr(SheetIndex) + '_DIRECTIVE_' + IntToStr(DirectiveCount) + '",');
        JsonList.Add('          "type": "parameterSet",');
        JsonList.Add('          "source": "eParameterSet",');
        JsonList.Add('          "x": ' + IntToStr(DirectiveObj.Location.X) + ',');
        JsonList.Add('          "y": ' + IntToStr(DirectiveObj.Location.Y));
        JsonList.Add('        }');
        Inc(DirectiveCount);
        DirectiveObj := Iterator.NextSchObject;
    end;
    SchDoc.SchIterator_Destroy(Iterator);
    JsonList.Add('      ],');
    JsonList.Add('      "graphicPrimitives": [],');
    JsonList.Add('      "graphicsExtraction": {');
    JsonList.Add('        "symbolBodies": "pinBoundsFallback",');
    JsonList.Add('        "nativeSymbolPrimitives": "reservedNotExportedInCompatibilityBuild",');
    JsonList.Add('        "ports": "exportedViaEPort",');
    JsonList.Add('        "powerPorts": "exportedViaEPowerObject",');
    JsonList.Add('        "offSheetConnectors": "reservedEnumUnavailableInTargetAltium",');
    JsonList.Add('        "junctions": "nativeViaEJunction_plusViewerSideTopologyFallback",');
    JsonList.Add('        "noERC": "exportedViaENoERC",');
    JsonList.Add('        "junctionTopologyFallback": "viewerSideWireTopology",');
    JsonList.Add('        "buses": "exportedViaEBus",');
    JsonList.Add('        "busEntries": "exportedViaEBusEntry",');
    JsonList.Add('        "sheetSymbols": "exportedViaESheetSymbol_withNameAndFileName",');
    JsonList.Add('        "sheetEntries": "exportedViaESheetEntry_withName",');
    JsonList.Add('        "notes": "V42 keeps SCH extraction compile-safe in the target Altium version: components, pins, wires and net labels are exported; native symbol graphics remain a typed empty container; schematic directives are exported via eParameterSet; sheet symbols and sheet entries are exported via their native schematic object enums, with a first attempt to read SheetSymbol.Name, SheetSymbol.FileName and SheetEntry.Name; off-sheet connector extraction is kept as an empty stable container because eOffSheetConnector is not declared in this target Altium API; buses and bus entries are exported when the target Altium API exposes eBus/eBusEntry; ports, power ports and NoERC markers are exported when the target Altium API exposes ePort/ePowerObject/eNoERC. Native eJunction is still attempted, and V42 keeps an explicit viewer-side topology fallback for projects where Altium returns zero native junction objects."');
    JsonList.Add('      }');
    JsonList.Add('    }');

    AppendExportLog('Added schematic sheet v41: ' + FileName + ' components=' + IntToStr(CompCount) + ' wires=' + IntToStr(WireCount) + ' netLabels=' + IntToStr(NetCount) + ' ports=' + IntToStr(PortCount) + ' powerPorts=' + IntToStr(PowerCount) + ' junctions=' + IntToStr(JunctionCount) + ' noERC=' + IntToStr(NoERCCount) + ' buses=' + IntToStr(BusCount) + ' busEntries=' + IntToStr(BusEntryCount) + ' directives=' + IntToStr(DirectiveCount) + ' offSheetConnectors=' + IntToStr(OffSheetCount) + ' sheetSymbols=' + IntToStr(SheetSymbolCount) + ' sheetEntries=' + IntToStr(SheetEntryCount));
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
    FilePath := GetProjectPath + ChangeFileExt(FileName, PCB_OUTPUT_SUFFIX);

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
        JsonList.Add('    "boardOutline": "nativeBoardOutlineBoundingRectanglePlusKeepOutLayerEdges",');
        JsonList.Add('    "polygons": "reserved",');
        JsonList.Add('    "splitPlanes": "reserved",');
        JsonList.Add('    "regions": "reserved",');
        JsonList.Add('    "notes": "V42 keeps the validated native Board.BoardOutline.BoundingRectangle path, exports KeepOut outline edges, and computes arc-aware viewer-ready bounds so the display does not fall back to all-object extents. The viewer should prefer boardOutlineEdges where edgeClass=boardOutlineCandidate for the visible outline, while retaining localKeepoutOrCutoutCandidate for drill/mounting/cutout context."');
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

        AppendExportLog('PCB exporter version: ' + SCRIPT_VERSION + ' / ' + SCHEMA_VERSION);
        AppendExportLog('PCB output suffix forced: ' + PCB_OUTPUT_SUFFIX);
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
        JsonList.Add('  "schemaVersion": "' + SCHEMATIC_SCHEMA_VERSION + '",');
        JsonList.Add('  "exportGoal": "universalLogicalPlusHierarchyAnchorsAndObjectProbeV42",');
        JsonList.Add('  "compatibilityMode": "v42-safe-sch-hierarchy-anchors-plus-object-probe",');
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

        JsonList.Add('  ],');
        JsonList.Add('  "hierarchy": {');
        JsonList.Add('    "version": "v42",');
        JsonList.Add('    "status": "viewerResolvableHierarchyAnchors",');
        JsonList.Add('    "source": "schematicSheetSymbolsSheetEntriesPortsAndProjectDocuments",');
        JsonList.Add('    "safeMode": true,');
        JsonList.Add('    "anchorExport": "perSheetHierarchyAnchors",');
        JsonList.Add('    "sheetCount": ' + IntToStr(SheetCount) + ',');
        JsonList.Add('    "nativeNameStatus": {');
        JsonList.Add('      "sheetSymbolName": "unavailableInTargetApi",');
        JsonList.Add('      "sheetSymbolFileName": "unavailableInTargetApi",');
        JsonList.Add('      "sheetEntryName": "unavailableInTargetApi"');
        JsonList.Add('    },');
        JsonList.Add('    "resolutionStrategy": [');
        JsonList.Add('      "Use project sheet order and sheet paths as the authoritative sheet list.",');
        JsonList.Add('      "Use each parent sheet sheetSymbols and sheetEntries coordinates as hierarchy connection anchors.",');
        JsonList.Add('      "Resolve child sheets viewer-side by matching sheet entry positions to parent sheet-symbol geometry when bounds become available.",');
        JsonList.Add('      "Resolve nets viewer-side by matching sheetEntries to ports/netLabels by name when names are available, otherwise by coordinate proximity and attached wires."');
        JsonList.Add('    ],');
        JsonList.Add('    "anchors": "see sheets[].hierarchyAnchors",');
        JsonList.Add('    "edges": [],');
        JsonList.Add('    "notes": "V42 keeps a global hierarchy contract without reading new risky Altium properties. Existing per-sheet arrays plus sheets[].hierarchyAnchors contain the raw data needed by the viewer to infer inter-sheet connectivity. Native sheet symbol and sheet entry names remain unavailable in this target API and are therefore not used in the script."');
        JsonList.Add('  }');
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


{==============================================================================}
{ 3b. SCHEMATIC OBJECT PROBE - v42 DIAGNOSTIC ADD-ON                           }
{==============================================================================}

function ProbeEscapeCell(const S : String) : String;
var
    i : Integer;
    C : Char;
begin
    Result := S;
    for i := 1 to Length(Result) do
    begin
        C := Result[i];
        if (C = ';') or (C = #9) or (C = #13) or (C = #10) then
            Result[i] := ' ';
    end;
end;

procedure ProbeIncCounter(Counters : TStringList; const Key : String);
var
    Idx : Integer;
    N   : Integer;
begin
    if Counters = nil then Exit;
    Idx := Counters.IndexOfName(Key);
    if Idx < 0 then
        Counters.Add(Key + '=1')
    else
    begin
        N := StrToInt(Counters.Values[Key]);
        Counters.Values[Key] := IntToStr(N + 1);
    end;
end;

function ProbeKnownObjectIdName(ObjectId : Integer) : String;
begin
    Result := 'unknown';
    if ObjectId = eSchComponent then begin Result := 'eSchComponent'; Exit; end;
    if ObjectId = ePin then begin Result := 'ePin'; Exit; end;
    if ObjectId = eWire then begin Result := 'eWire'; Exit; end;
    if ObjectId = eNetLabel then begin Result := 'eNetLabel'; Exit; end;
    if ObjectId = ePort then begin Result := 'ePort'; Exit; end;
    if ObjectId = ePowerObject then begin Result := 'ePowerObject'; Exit; end;
    if ObjectId = eJunction then begin Result := 'eJunction'; Exit; end;
    if ObjectId = eNoERC then begin Result := 'eNoERC'; Exit; end;
    if ObjectId = eBus then begin Result := 'eBus'; Exit; end;
    if ObjectId = eBusEntry then begin Result := 'eBusEntry'; Exit; end;
    if ObjectId = eParameter then begin Result := 'eParameter'; Exit; end;
    if ObjectId = eParameterSet then begin Result := 'eParameterSet'; Exit; end;
    if ObjectId = eSheetSymbol then begin Result := 'eSheetSymbol'; Exit; end;
    if ObjectId = eSheetEntry then begin Result := 'eSheetEntry'; Exit; end;
end;

function ProbeTryObjectId(Obj : Variant) : Integer;
begin
    Result := -1;
    try
        Result := Obj.ObjectId;
    except
        Result := -1;
    end;
end;

function ProbeTryLocationX(Obj : Variant) : String;
begin
    // V42c: generic Obj.Location is not exposed in this Altium API.
    Result := '';
end;

function ProbeTryLocationY(Obj : Variant) : String;
begin
    // V42c: generic Obj.Location is not exposed in this Altium API.
    Result := '';
end;

function ProbeTryText(Obj : Variant) : String;
begin
    // V42c: keep probe compile-safe. Generic Obj.Text is not exposed in this Altium API.
    Result := '';
end;

function ProbeTryName(Obj : Variant) : String;
begin
    // V42c: keep probe compile-safe. Generic Obj.Name is not exposed reliably.
    Result := '';
end;

function ProbeTryDesignator(Obj : Variant) : String;
begin
    // V42c: avoid generic Obj.Designator.Text in the all-object probe.
    Result := '';
end;

function ProbeTryComment(Obj : Variant) : String;
begin
    // V42c: avoid generic Obj.Comment.Text in the all-object probe.
    Result := '';
end;

function ProbeTryLibRef(Obj : Variant) : String;
begin
    // V42c: avoid generic Obj.LibReference in the all-object probe.
    Result := '';
end;

function ProbeTryFileName(Obj : Variant) : String;
begin
    // V42c: avoid generic Obj.FileName in the all-object probe.
    Result := '';
end;

procedure ProbeDumpObjectLine(Raw : TStringList; Counters : TStringList; const SheetId : String; const SheetName : String; ObjIndex : Integer; Obj : Variant);
var
    Oid      : Integer;
    TypeName : String;
    Key      : String;
begin
    Oid := ProbeTryObjectId(Obj);
    TypeName := ProbeKnownObjectIdName(Oid);
    Key := IntToStr(Oid) + ' ' + TypeName;
    ProbeIncCounter(Counters, Key);

    Raw.Add(
        ProbeEscapeCell(SheetId) + ';' +
        ProbeEscapeCell(SheetName) + ';' +
        IntToStr(ObjIndex) + ';' +
        IntToStr(Oid) + ';' +
        ProbeEscapeCell(TypeName) + ';' +
        ProbeEscapeCell(ProbeTryLocationX(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryLocationY(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryText(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryName(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryDesignator(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryComment(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryLibRef(Obj)) + ';' +
        ProbeEscapeCell(ProbeTryFileName(Obj))
    );
end;

procedure ProbeDumpSchDocument(Raw : TStringList; Summary : TStringList; GlobalCounters : TStringList; SchDoc : ISch_Document; const SchPath : String; SheetIndex : Integer);
var
    Iterator      : ISch_Iterator;
    Obj           : Variant;
    SheetCounters : TStringList;
    ObjIndex      : Integer;
    i             : Integer;
    SheetName     : String;
    SheetId       : String;
    Oid           : Integer;
    Key           : String;
begin
    SheetId := 'SHEET_' + IntToStr(SheetIndex);
    SheetName := ChangeFileExt(ExtractFileName(SchPath), '');
    if SheetName = '' then
        SheetName := ChangeFileExt(ExtractFileName(SchDoc.DocumentName), '');

    SheetCounters := TStringList.Create;
    try
        Summary.Add('');
        Summary.Add('[' + SheetId + '] ' + SheetName);
        Summary.Add('Path=' + SchPath);

        Iterator := SchDoc.SchIterator_Create;
        if Iterator = nil then
        begin
            Summary.Add('Iterator=nil');
            Exit;
        end;

        ObjIndex := 0;
        Obj := Iterator.FirstSchObject;
        while Obj <> nil do
        begin
            ProbeDumpObjectLine(Raw, SheetCounters, SheetId, SheetName, ObjIndex, Obj);
            Oid := ProbeTryObjectId(Obj);
            Key := IntToStr(Oid) + ' ' + ProbeKnownObjectIdName(Oid);
            ProbeIncCounter(GlobalCounters, Key);
            Inc(ObjIndex);
            Obj := Iterator.NextSchObject;
        end;
        SchDoc.SchIterator_Destroy(Iterator);

        Summary.Add('ObjectCount=' + IntToStr(ObjIndex));
        SheetCounters.Sort;
        for i := 0 to SheetCounters.Count - 1 do
            Summary.Add('  ' + SheetCounters.Strings[i]);
    finally
        SheetCounters.Free;
    end;
end;

procedure ExportSchObjectProbeReport;
var
    Workspace      : IWorkSpace;
    Project        : IProject;
    Document       : IDocument;
    SchDoc         : ISch_Document;
    Raw            : TStringList;
    Summary        : TStringList;
    GlobalCounters : TStringList;
    i              : Integer;
    SheetCount     : Integer;
    Ext            : String;
    RawPath        : String;
    SummaryPath    : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then begin AppendExportLog('Object probe skipped: no workspace'); Exit; end;
    Project := Workspace.DM_FocusedProject;
    if Project = nil then begin AppendExportLog('Object probe skipped: no focused project'); Exit; end;

    Raw := TStringList.Create;
    Summary := TStringList.Create;
    GlobalCounters := TStringList.Create;
    try
        Raw.Add('sheetId;sheetName;objectIndex;objectId;knownType;x;y;text;name;designator;comment;libRef;fileName');
        Summary.Add('Altium schematic object probe embedded in ExportDesignData');
        Summary.Add('Version=' + SCRIPT_VERSION);
        Summary.Add('Schema=' + SCHEMA_VERSION);
        Summary.Add('Project=' + Project.DM_ProjectFullPath);
        Summary.Add('OutputFolder=' + GetProjectPath);
        Summary.Add('Purpose=discover raw ObjectId values returned by SchIterator_Create without filters');
        Summary.Add('');

        SheetCount := 0;
        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));
            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    ProbeDumpSchDocument(Raw, Summary, GlobalCounters, SchDoc, Document.DM_FullPath, SheetCount);
                    Inc(SheetCount);
                end
                else
                    Summary.Add('Unable to load SCH: ' + Document.DM_FullPath);
            end;
        end;

        Summary.Add('');
        Summary.Add('[GLOBAL]');
        Summary.Add('SheetCount=' + IntToStr(SheetCount));
        GlobalCounters.Sort;
        for i := 0 to GlobalCounters.Count - 1 do
            Summary.Add('  ' + GlobalCounters.Strings[i]);

        RawPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_object_probe_raw.csv');
        SummaryPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_object_probe_summary.txt');
        Raw.SaveToFile(RawPath);
        Summary.SaveToFile(SummaryPath);
        AppendExportLog('Saved SCH object probe raw: ' + RawPath);
        AppendExportLog('Saved SCH object probe summary: ' + SummaryPath);
    finally
        Raw.Free;
        Summary.Free;
        GlobalCounters.Free;
    end;
end;



{==============================================================================}
{ 3c. SCH API MAPPER - v43b SAFE OBJECTID MAP                                  }
{==============================================================================}

function V43ApiMapperHintForObjectId(ObjectId : Integer) : String;
begin
    Result := 'unknownNeedsTargetedProbe';
    if ObjectId = eSchComponent then begin Result := 'nativeComponent'; Exit; end;
    if ObjectId = ePin then begin Result := 'nativePin'; Exit; end;
    if ObjectId = eWire then begin Result := 'nativeWire'; Exit; end;
    if ObjectId = eNetLabel then begin Result := 'nativeNetLabel'; Exit; end;
    if ObjectId = ePort then begin Result := 'nativePort'; Exit; end;
    if ObjectId = ePowerObject then begin Result := 'nativePowerPort'; Exit; end;
    if ObjectId = eNoERC then begin Result := 'nativeNoERC'; Exit; end;
    if ObjectId = eBus then begin Result := 'nativeBus'; Exit; end;
    if ObjectId = eBusEntry then begin Result := 'nativeBusEntry'; Exit; end;
    if ObjectId = eParameter then begin Result := 'nativeParameter_or_componentParameter'; Exit; end;
    if ObjectId = eParameterSet then begin Result := 'nativeDirectiveParameterSet'; Exit; end;
    if ObjectId = eSheetSymbol then begin Result := 'nativeSheetSymbol_locationOnlyValidated'; Exit; end;
    if ObjectId = eSheetEntry then begin Result := 'nativeSheetEntry_locationOnlyValidated'; Exit; end;

    // Heuristics observed on AGMA v42c probe. These are not hard-coded as final
    // truth; they simply rank the next reverse-engineering targets.
    if ObjectId = 18 then begin Result := 'candidateGraphicOrTextPrimitive_highVolume'; Exit; end;
    if ObjectId = 22 then begin Result := 'candidateTextOrAnnotation_highVolume'; Exit; end;
    if ObjectId = 25 then begin Result := 'candidateComponentDesignatorOrComment_countMatchesComponents'; Exit; end;
    if ObjectId = 44 then begin Result := 'candidateComponentChildGraphicOrModel'; Exit; end;
    if ObjectId = 45 then begin Result := 'candidateComponentChildDesignator_countMatchesComponents'; Exit; end;
    if ObjectId = 46 then begin Result := 'candidateComponentChildComment_countMatchesComponents'; Exit; end;
    if ObjectId = 5 then begin Result := 'candidateGraphicPrimitive_highVolume'; Exit; end;
    if ObjectId = 8 then begin Result := 'candidateTextFrameOrDrawingPrimitive_highVolume'; Exit; end;
    if ObjectId = 42 then begin Result := 'candidateSheetDocumentObject_onePerSheet'; Exit; end;
    if ObjectId = 61 then begin Result := 'candidateHarnessOrSpecialConnector'; Exit; end;
end;

function V43ApiMapperNextActionForObjectId(ObjectId : Integer) : String;
begin
    Result := 'createTargetedTypedProbeForThisObjectId';
    if (ObjectId = eSchComponent) or (ObjectId = ePin) or (ObjectId = eWire) or
       (ObjectId = eNetLabel) or (ObjectId = ePort) or (ObjectId = ePowerObject) or
       (ObjectId = eNoERC) or (ObjectId = eBus) or (ObjectId = eBusEntry) or
       (ObjectId = eParameter) or (ObjectId = eParameterSet) then
    begin
        Result := 'alreadyExportedOrMostlyExported';
        Exit;
    end;
    if (ObjectId = eSheetSymbol) or (ObjectId = eSheetEntry) then
    begin
        Result := 'probeAlternativePropertiesForNameFileNameBoundsAndOwner';
        Exit;
    end;
    if (ObjectId = 18) or (ObjectId = 22) or (ObjectId = 5) or (ObjectId = 8) then
    begin
        Result := 'probeAsGraphicalTextLineArcRectangleImageUsingObjectIdFilter';
        Exit;
    end;
    if (ObjectId = 25) or (ObjectId = 44) or (ObjectId = 45) or (ObjectId = 46) then
    begin
        Result := 'probeComponentChildObjectsAndSymbolGraphics';
        Exit;
    end;
end;

function V43CounterKeyObjectId(const Key : String) : Integer;
var
    P : Integer;
    S : String;
begin
    P := Pos(' ', Key);
    if P > 0 then S := Copy(Key, 1, P - 1) else S := Key;
    try
        Result := StrToInt(S);
    except
        Result := -1;
    end;
end;

procedure V43ApiMapperDumpSchDocument(Csv : TStringList; GlobalCounters : TStringList; SchDoc : ISch_Document; const SchPath : String; SheetIndex : Integer);
var
    Iterator      : ISch_Iterator;
    Obj           : Variant;
    SheetCounters : TStringList;
    SheetId       : String;
    SheetName     : String;
    ObjIndex      : Integer;
    Oid           : Integer;
    Key           : String;
    i             : Integer;
    CountStr      : String;
    KnownName     : String;
    Hint          : String;
    NextAction    : String;
begin
    SheetId := 'SHEET_' + IntToStr(SheetIndex);
    SheetName := ChangeFileExt(ExtractFileName(SchPath), '');
    if SheetName = '' then
        SheetName := ChangeFileExt(ExtractFileName(SchDoc.DocumentName), '');

    SheetCounters := TStringList.Create;
    try
        Iterator := SchDoc.SchIterator_Create;
        if Iterator = nil then Exit;

        ObjIndex := 0;
        Obj := Iterator.FirstSchObject;
        while Obj <> nil do
        begin
            Oid := ProbeTryObjectId(Obj);
            Key := IntToStr(Oid) + ' ' + ProbeKnownObjectIdName(Oid);
            ProbeIncCounter(SheetCounters, Key);
            ProbeIncCounter(GlobalCounters, Key);
            Inc(ObjIndex);
            Obj := Iterator.NextSchObject;
        end;
        SchDoc.SchIterator_Destroy(Iterator);

        SheetCounters.Sort;
        for i := 0 to SheetCounters.Count - 1 do
        begin
            Key := SheetCounters.Names[i];
            CountStr := SheetCounters.ValueFromIndex[i];
            Oid := V43CounterKeyObjectId(Key);
            KnownName := ProbeKnownObjectIdName(Oid);
            Hint := V43ApiMapperHintForObjectId(Oid);
            NextAction := V43ApiMapperNextActionForObjectId(Oid);
            Csv.Add(
                ProbeEscapeCell(SheetId) + ';' +
                ProbeEscapeCell(SheetName) + ';' +
                ProbeEscapeCell(SchPath) + ';' +
                IntToStr(Oid) + ';' +
                ProbeEscapeCell(KnownName) + ';' +
                ProbeEscapeCell(CountStr) + ';' +
                ProbeEscapeCell(Hint) + ';' +
                ProbeEscapeCell(NextAction)
            );
        end;
    finally
        SheetCounters.Free;
    end;
end;

procedure ExportSchApiMapperReport;
var
    Workspace      : IWorkSpace;
    Project        : IProject;
    Document       : IDocument;
    SchDoc         : ISch_Document;
    Csv            : TStringList;
    Summary        : TStringList;
    GlobalCounters : TStringList;
    i              : Integer;
    SheetCount     : Integer;
    Ext            : String;
    CsvPath        : String;
    SummaryPath    : String;
    Key            : String;
    Oid            : Integer;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then begin AppendExportLog('SCH API mapper skipped: no workspace'); Exit; end;
    Project := Workspace.DM_FocusedProject;
    if Project = nil then begin AppendExportLog('SCH API mapper skipped: no focused project'); Exit; end;

    Csv := TStringList.Create;
    Summary := TStringList.Create;
    GlobalCounters := TStringList.Create;
    try
        Csv.Add('sheetId;sheetName;sheetPath;objectId;knownType;count;v43bHint;nextAction');
        Summary.Add('Altium schematic API mapper embedded in ExportDesignData');
        Summary.Add('Version=' + SCRIPT_VERSION);
        Summary.Add('Schema=' + SCHEMA_VERSION);
        Summary.Add('Project=' + Project.DM_ProjectFullPath);
        Summary.Add('OutputFolder=' + GetProjectPath);
        Summary.Add('Purpose=rank ObjectId families and define the next targeted typed probes without risking unsupported generic properties');
        Summary.Add('');

        SheetCount := 0;
        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));
            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    V43ApiMapperDumpSchDocument(Csv, GlobalCounters, SchDoc, Document.DM_FullPath, SheetCount);
                    Inc(SheetCount);
                end;
            end;
        end;

        Summary.Add('[GLOBAL_OBJECTID_MAP]');
        Summary.Add('SheetCount=' + IntToStr(SheetCount));
        GlobalCounters.Sort;
        for i := 0 to GlobalCounters.Count - 1 do
        begin
            Key := GlobalCounters.Names[i];
            Oid := V43CounterKeyObjectId(Key);
            Summary.Add('  ' + Key + '=' + GlobalCounters.ValueFromIndex[i] +
                        ' ; hint=' + V43ApiMapperHintForObjectId(Oid) +
                        ' ; next=' + V43ApiMapperNextActionForObjectId(Oid));
        end;

        CsvPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_api_mapper_targeted.csv');
        SummaryPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_api_mapper_summary.txt');
        Csv.SaveToFile(CsvPath);
        Summary.SaveToFile(SummaryPath);
        AppendExportLog('Saved SCH API mapper CSV: ' + CsvPath);
        AppendExportLog('Saved SCH API mapper summary: ' + SummaryPath);
    finally
        Csv.Free;
        Summary.Free;
        GlobalCounters.Free;
    end;
end;


{==============================================================================}
{ 3d. SCH OBJECT ORDER PROBE - v44 SAFE RAW SEQUENCE                           }
{==============================================================================}
{ Purpose:
  The v43b mapper proved that unknown ObjectId families exist in large numbers.
  V44 does not access risky generic properties such as Text/Name/Location.
  It only records the flat iterator order for every schematic object.
  This lets us detect repeated patterns around components, parameters,
  designators/comments, symbol graphics and sheet hierarchy objects. }

function V44IsPriorityObjectId(ObjectId : Integer) : String;
begin
    Result := '0';
    if (ObjectId = 18) or (ObjectId = 22) or (ObjectId = 25) or
       (ObjectId = 44) or (ObjectId = 45) or (ObjectId = 46) or
       (ObjectId = 5) or (ObjectId = 8) or (ObjectId = eSheetEntry) or
       (ObjectId = eSheetSymbol) or (ObjectId = 61) then
        Result := '1';
end;

procedure V44ObjectOrderDumpSchDocument(Csv : TStringList; SchDoc : ISch_Document; const SchPath : String; SheetIndex : Integer);
var
    Iterator  : ISch_Iterator;
    Obj       : Variant;
    SheetId   : String;
    SheetName : String;
    ObjIndex  : Integer;
    Oid       : Integer;
    KnownName : String;
    Hint      : String;
    Action    : String;
begin
    SheetId := 'SHEET_' + IntToStr(SheetIndex);
    SheetName := ChangeFileExt(ExtractFileName(SchPath), '');
    if SheetName = '' then
        SheetName := ChangeFileExt(ExtractFileName(SchDoc.DocumentName), '');

    Iterator := SchDoc.SchIterator_Create;
    if Iterator = nil then Exit;

    ObjIndex := 0;
    Obj := Iterator.FirstSchObject;
    while Obj <> nil do
    begin
        Oid := ProbeTryObjectId(Obj);
        KnownName := ProbeKnownObjectIdName(Oid);
        Hint := V43ApiMapperHintForObjectId(Oid);
        Action := V43ApiMapperNextActionForObjectId(Oid);

        Csv.Add(
            ProbeEscapeCell(SheetId) + ';' +
            ProbeEscapeCell(SheetName) + ';' +
            ProbeEscapeCell(SchPath) + ';' +
            IntToStr(ObjIndex) + ';' +
            IntToStr(Oid) + ';' +
            ProbeEscapeCell(KnownName) + ';' +
            ProbeEscapeCell(Hint) + ';' +
            ProbeEscapeCell(Action) + ';' +
            V44IsPriorityObjectId(Oid)
        );

        Inc(ObjIndex);
        Obj := Iterator.NextSchObject;
    end;

    SchDoc.SchIterator_Destroy(Iterator);
end;

procedure ExportSchObjectOrderReport;
var
    Workspace   : IWorkSpace;
    Project     : IProject;
    Document    : IDocument;
    SchDoc      : ISch_Document;
    Csv         : TStringList;
    Summary     : TStringList;
    i           : Integer;
    SheetCount  : Integer;
    Ext         : String;
    CsvPath     : String;
    SummaryPath : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then begin AppendExportLog('SCH object order probe skipped: no workspace'); Exit; end;
    Project := Workspace.DM_FocusedProject;
    if Project = nil then begin AppendExportLog('SCH object order probe skipped: no focused project'); Exit; end;

    Csv := TStringList.Create;
    Summary := TStringList.Create;
    try
        Csv.Add('sheetId;sheetName;sheetPath;objectIndex;objectId;knownType;v44Hint;nextAction;priorityTarget');
        Summary.Add('Altium schematic object order probe embedded in ExportDesignData');
        Summary.Add('Version=' + SCRIPT_VERSION);
        Summary.Add('Schema=' + SCHEMA_VERSION);
        Summary.Add('Project=' + Project.DM_ProjectFullPath);
        Summary.Add('OutputFolder=' + GetProjectPath);
        Summary.Add('Purpose=record flat SchIterator object order without risky generic properties');
        Summary.Add('Use=analyze repeated sequences around components, parameters, designator/comment objects, sheet symbols and graphics');
        Summary.Add('SafeProperties=ObjectId only');
        Summary.Add('');

        SheetCount := 0;
        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));
            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    V44ObjectOrderDumpSchDocument(Csv, SchDoc, Document.DM_FullPath, SheetCount);
                    Inc(SheetCount);
                end;
            end;
        end;

        Summary.Add('SheetCount=' + IntToStr(SheetCount));
        Summary.Add('CsvColumns=sheetId;sheetName;sheetPath;objectIndex;objectId;knownType;v44Hint;nextAction;priorityTarget');

        CsvPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_object_order.csv');
        SummaryPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_object_order_summary.txt');
        Csv.SaveToFile(CsvPath);
        Summary.SaveToFile(SummaryPath);
        AppendExportLog('Saved SCH object order CSV: ' + CsvPath);
        AppendExportLog('Saved SCH object order summary: ' + SummaryPath);
    finally
        Csv.Free;
        Summary.Free;
    end;
end;


{==============================================================================}
{ 3e. COMPONENT CONTEXT PROBE - v45 SAFE CLUSTERING                             }
{==============================================================================}
{ Purpose:
  V44 showed that unknown ObjectId families are regularly ordered around
  components and hierarchy objects. V45 keeps the same safe rule: ObjectId only.
  It assigns nearby unknown objects to a component cluster using iterator order.
  This is a zero-risk way to confirm designator/comment/symbol-primitive
  families before using more specific Altium interfaces in later versions. }

function V45RoleHypothesisForObjectId(ObjectId : Integer) : String;
begin
    Result := 'notTargeted';
    if ObjectId = 26 then Result := 'componentRoot'
    else if ObjectId = 37 then Result := 'componentPin'
    else if ObjectId = 27 then Result := 'parameterOrComponentParameter'
    else if ObjectId = 25 then Result := 'candidateComponentDesignatorOrPrimaryText_countMatchesComponents'
    else if ObjectId = 44 then Result := 'candidateComponentGraphicOrModel'
    else if ObjectId = 45 then Result := 'candidateComponentDesignator_countMatchesComponents'
    else if ObjectId = 46 then Result := 'candidateComponentComment_countMatchesComponents'
    else if ObjectId = 4 then Result := 'candidateComponentPrimitiveOrAnchor'
    else if ObjectId = 18 then Result := 'candidateGraphicOrTextPrimitive_highVolume'
    else if ObjectId = 22 then Result := 'candidateTextOrAnnotation_highVolume'
    else if ObjectId = 5 then Result := 'candidateGraphicPrimitive_highVolume'
    else if ObjectId = 8 then Result := 'candidateTextFrameOrDrawingPrimitive_highVolume'
    else if ObjectId = 40 then Result := 'sheetEntry'
    else if ObjectId = 41 then Result := 'sheetSymbol'
    else if ObjectId = 61 then Result := 'candidateHarnessOrSpecialConnector';
end;

function V45IsComponentContextTarget(ObjectId : Integer) : Boolean;
begin
    Result := False;
    if (ObjectId = 26) or (ObjectId = 37) or (ObjectId = 27) or
       (ObjectId = 25) or (ObjectId = 44) or (ObjectId = 45) or
       (ObjectId = 46) or (ObjectId = 4) or (ObjectId = 40) or
       (ObjectId = 41) or (ObjectId = 61) then
        Result := True;
end;

procedure V45ComponentContextDumpSchDocument(Csv : TStringList; Counters : TStringList; SchDoc : ISch_Document; const SchPath : String; SheetIndex : Integer);
var
    Iterator        : ISch_Iterator;
    Obj             : Variant;
    SheetId         : String;
    SheetName       : String;
    ObjIndex        : Integer;
    Oid             : Integer;
    ComponentIndex  : Integer;
    OffsetFromComp  : Integer;
    KnownName       : String;
    Role            : String;
    ClusterId       : String;
    Key             : String;
begin
    SheetId := 'SHEET_' + IntToStr(SheetIndex);
    SheetName := ChangeFileExt(ExtractFileName(SchPath), '');
    if SheetName = '' then
        SheetName := ChangeFileExt(ExtractFileName(SchDoc.DocumentName), '');

    Iterator := SchDoc.SchIterator_Create;
    if Iterator = nil then Exit;

    ObjIndex := 0;
    ComponentIndex := -1;
    OffsetFromComp := -1;

    Obj := Iterator.FirstSchObject;
    while Obj <> nil do
    begin
        Oid := ProbeTryObjectId(Obj);

        if Oid = 26 then
        begin
            Inc(ComponentIndex);
            OffsetFromComp := 0;
        end
        else if ComponentIndex >= 0 then
            Inc(OffsetFromComp);

        if V45IsComponentContextTarget(Oid) then
        begin
            KnownName := ProbeKnownObjectIdName(Oid);
            Role := V45RoleHypothesisForObjectId(Oid);
            if ComponentIndex >= 0 then
                ClusterId := SheetId + '_COMPCLUSTER_' + IntToStr(ComponentIndex)
            else
                ClusterId := SheetId + '_PRECOMPONENT';

            Key := IntToStr(Oid) + ' ' + Role;
            ProbeIncCounter(Counters, Key);

            Csv.Add(
                ProbeEscapeCell(SheetId) + ';' +
                ProbeEscapeCell(SheetName) + ';' +
                ProbeEscapeCell(SchPath) + ';' +
                IntToStr(ObjIndex) + ';' +
                ProbeEscapeCell(ClusterId) + ';' +
                IntToStr(ComponentIndex) + ';' +
                IntToStr(OffsetFromComp) + ';' +
                IntToStr(Oid) + ';' +
                ProbeEscapeCell(KnownName) + ';' +
                ProbeEscapeCell(Role)
            );
        end;

        Inc(ObjIndex);
        Obj := Iterator.NextSchObject;
    end;

    SchDoc.SchIterator_Destroy(Iterator);
end;

procedure ExportSchComponentContextReport;
var
    Workspace   : IWorkSpace;
    Project     : IProject;
    Document    : IDocument;
    SchDoc      : ISch_Document;
    Csv         : TStringList;
    Summary     : TStringList;
    Counters    : TStringList;
    i           : Integer;
    SheetCount  : Integer;
    Ext         : String;
    CsvPath     : String;
    SummaryPath : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then begin AppendExportLog('SCH component context probe skipped: no workspace'); Exit; end;
    Project := Workspace.DM_FocusedProject;
    if Project = nil then begin AppendExportLog('SCH component context probe skipped: no focused project'); Exit; end;

    Csv := TStringList.Create;
    Summary := TStringList.Create;
    Counters := TStringList.Create;
    try
        Csv.Add('sheetId;sheetName;sheetPath;objectIndex;componentClusterId;componentIndex;offsetFromComponent;objectId;knownType;v45RoleHypothesis');
        Summary.Add('Altium schematic component context probe embedded in ExportDesignData');
        Summary.Add('Version=' + SCRIPT_VERSION);
        Summary.Add('Schema=' + SCHEMA_VERSION);
        Summary.Add('Project=' + Project.DM_ProjectFullPath);
        Summary.Add('OutputFolder=' + GetProjectPath);
        Summary.Add('Purpose=assign repeated unknown ObjectId families to component clusters using flat iterator order');
        Summary.Add('SafeProperties=ObjectId only');
        Summary.Add('CsvColumns=sheetId;sheetName;sheetPath;objectIndex;componentClusterId;componentIndex;offsetFromComponent;objectId;knownType;v45RoleHypothesis');
        Summary.Add('');

        SheetCount := 0;
        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));
            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    V45ComponentContextDumpSchDocument(Csv, Counters, SchDoc, Document.DM_FullPath, SheetCount);
                    Inc(SheetCount);
                end;
            end;
        end;

        Summary.Add('SheetCount=' + IntToStr(SheetCount));
        Summary.Add('[TARGET_OBJECT_COUNTS]');
        Counters.Sort;
        for i := 0 to Counters.Count - 1 do
            Summary.Add('  ' + Counters.Strings[i]);
        Summary.Add('');
        Summary.Add('[NEXT]');
        Summary.Add('Use the CSV to verify which ObjectId families are consistently attached to component clusters.');
        Summary.Add('If 45/46 remain one-per-component near each cluster, v46 can safely target them as designator/comment display objects.');
        Summary.Add('If 44/25/4 cluster around components, v46 can focus on native symbol graphics/bounds extraction.');

        CsvPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_component_context.csv');
        SummaryPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_component_context_summary.txt');
        Csv.SaveToFile(CsvPath);
        Summary.SaveToFile(SummaryPath);
        AppendExportLog('Saved SCH component context CSV: ' + CsvPath);
        AppendExportLog('Saved SCH component context summary: ' + SummaryPath);
    finally
        Csv.Free;
        Summary.Free;
        Counters.Free;
    end;
end;



{==============================================================================}
{ 3f. TARGETED NATIVE SYMBOL PRIMITIVE PROBE - v58 INTERFACE MATRIX COMPILE-SAFE            }
{======================================================================================
 HISTORIQUE DES ECHECS CONSERVES POUR NE PAS REESSAYER LES MEMES PISTES
 -------------------------------------------------------------------------------------
 - v52  : Obj.Location.X/Y sur ObjectId 44 -> ne compile pas: undeclared identifier Location.
 - v53  : Obj.BoundingRectangle -> ne compile pas: undeclared identifier BoundingRectangle.
 - v54  : Obj.X1/Y1/X2/Y2 -> non exploitable en acces generique; garde en statut SKIPPED.
 - v55  : multi-route safe, confirme que les chemins generiques restent bloques.
 - v56  : matrice d'interfaces, prepare les tests types sans geometrie directe.
 - v57  : ISch_Line/ISch_Rectangle/ISch_Arc avec .Location/.Corner/.Radius -> .Location
          ne compile pas sur ces interfaces dans cette API Altium.
 - v57b : CAST typé seul validé: 378/378 ObjectId 44 acceptés en ISch_Line, sans lecture géométrique.
 - v58  : test ciblé sur ISch_Line.GetState_Vertex(0/1), choisi car Wire/Bus utilisent déjà
          GetState_Vertex avec succès dans le même script.

 Decision v58:
 - on conserve les interfaces ISch_Line / ISch_Rectangle / ISch_Arc,
 - mais on teste uniquement le CAST typé, sans lire Location/Corner/Radius,
 - objectif: savoir si ObjectId 44 supporte vraiment une de ces interfaces avant de
   chercher les bons noms de proprietes geometriques.
======================================================================================}

{==============================================================================}
{ Purpose:
  V46 classified ObjectId 45 as high-confidence designator display object and
  ObjectId 46 as high-confidence comment display object by iterator context.

  Direct generic access such as Obj.Text is not compiled by this Altium
  DelphiScript engine for Variant schematic objects. V47 therefore uses the
  known-safe ISch_Component text accessors already validated by the main JSON
  exporter: Component.Designator.Text and Component.Comment.Text.

  For each candidate display object 25 / 45 / 46 found after a component root,
  this report associates it with the current component and records the native
  component designator/comment strings. This validates the semantic role of the
  display objects without touching unsupported properties on the unknown object
  itself. }

function V58DecisionForObjectId(ObjectId : Integer) : String;
begin
    Result := 'ignore';
    if ObjectId = 4 then Result := 'componentLocalPrimitiveOrAnchor_candidate'
    else if ObjectId = 25 then Result := 'componentPrimaryDisplayObject_candidateDesignatorOrPrimaryText'
    else if ObjectId = 44 then Result := 'componentNativeSymbolGraphic_candidate'
    else if ObjectId = 45 then Result := 'componentDesignatorDisplayObject_highConfidence'
    else if ObjectId = 46 then Result := 'componentCommentDisplayObject_highConfidence';
end;

function V58ExpectedTextKindForObjectId(ObjectId : Integer) : String;
begin
    Result := 'none';
    if ObjectId = 4 then Result := 'nativePrimitiveOrAnchor_noTextExpected'
    else if ObjectId = 25 then Result := 'primaryDisplayText_or_designator'
    else if ObjectId = 44 then Result := 'nativeSymbolGraphic_noTextExpected'
    else if ObjectId = 45 then Result := 'designatorText_expected'
    else if ObjectId = 46 then Result := 'commentText_expected';
end;

function V58IsTarget(ObjectId : Integer) : Boolean;
begin
    Result := False;
    if (ObjectId = 4) or (ObjectId = 25) or (ObjectId = 44) or (ObjectId = 45) or (ObjectId = 46) then
        Result := True;
end;



function V58InterfaceMatrixForObjectId(ObjectId : Integer) : String;
begin
    Result := 'none';
    if ObjectId = 44 then
        Result := 'batchA:ISch_Line/ISch_Rectangle/ISch_Arc;batchB:ISch_Ellipse/ISch_Polygon/ISch_Bezier;batchC:componentChildIteratorOrLibrarySymbolRoute'
    else if ObjectId = 4 then
        Result := 'batchA:componentLocalAnchorOrSmallPrimitive;batchB:pinRelatedPrimitive;batchC:componentOriginCorrelation'
    else if ObjectId = 25 then
        Result := 'batchA:displayObjectTextAlreadySolved;batchB:compareWithObject45Designator;batchC:hideFromSymbolBody'
    else if (ObjectId = 45) or (ObjectId = 46) then
        Result := 'validatedTextDisplayObject_noSymbolPrimitiveInterfaceNeeded';
end;

function V58CompileRiskPlanForObjectId(ObjectId : Integer) : String;
begin
    Result := 'safeNoNativeAccess';
    if ObjectId = 44 then
        Result := 'nextBuildCanEnableOneBatchAtATime:typedInterfaceCastOrChildIterator;doNotUseGenericObjProperties'
    else if ObjectId = 4 then
        Result := 'keepInMatrixButLowerPriorityThan44'
    else if ObjectId = 25 then
        Result := 'excludeFromNativeBodyUnlessInterfaceCastProvesGraphic'
    else if (ObjectId = 45) or (ObjectId = 46) then
        Result := 'textAnchorValidated';
end;

function V58TryTypedBatchASymbolPrimitive(Obj : Variant; var X1 : Integer; var Y1 : Integer; var X2 : Integer; var Y2 : Integer; var Status : String) : Boolean;
var
    LineObj : ISch_Line;
    RectObj : ISch_Rectangle;
    ArcObj  : ISch_Arc;
    P1      : TLocation;
    P2      : TLocation;
begin
    Result := False;
    X1 := 0;
    Y1 := 0;
    X2 := 0;
    Y2 := 0;
    Status := 'TYPED_BATCH_A_LINE_VERTEX_NO_MATCH';

    { v58 geometry test:
      v57b proved ObjectId 44 supports ISch_Line on all 378 candidates.
      v58 therefore tests ONE likely line geometry route only: ISch_Line.GetState_Vertex(0/1),
      mirroring the already validated wire/bus vertex access used elsewhere in this exporter.

      Still forbidden / already failed:
      - Obj.Location.X/Y                -> undeclared identifier Location
      - Obj.BoundingRectangle           -> undeclared identifier BoundingRectangle
      - Obj.X1/Y1/X2/Y2 generic         -> not exposed on generic Obj
      - LineObj.Location / RectObj...   -> undeclared identifier Location

      If GetState_Vertex fails to compile, v58b should disable this block and try the next
      single-property ISch_Line route, for example StartLocation/EndLocation or Point1/Point2. }

    try
        LineObj := Obj;
        if LineObj <> nil then
        begin
            P1 := LineObj.GetState_Vertex(0);
            P2 := LineObj.GetState_Vertex(1);
            X1 := P1.X;
            Y1 := P1.Y;
            X2 := P2.X;
            Y2 := P2.Y;
            Status := 'ISch_Line_GETSTATE_VERTEX_OK_V58';
            Result := True;
            Exit;
        end;
    except
        Status := 'ISch_Line_GETSTATE_VERTEX_RUNTIME_FAILED_OR_NO_VERTEX';
    end;

    { Keep rectangle and arc as cast-only fallback. No geometry properties are read here. }
    try
        RectObj := Obj;
        if RectObj <> nil then
        begin
            Status := Status + '|ISch_Rectangle_CAST_OK_GEOMETRY_NOT_READ_V58';
            Result := True;
            Exit;
        end;
    except
        Status := Status + '|ISch_Rectangle_CAST_FAILED';
    end;

    try
        ArcObj := Obj;
        if ArcObj <> nil then
        begin
            Status := Status + '|ISch_Arc_CAST_OK_GEOMETRY_NOT_READ_V58';
            Result := True;
            Exit;
        end;
    except
        Status := Status + '|ISch_Arc_CAST_FAILED';
    end;
end;

procedure V58LineVertexProbeDumpSchDocument(Csv : TStringList; Counters : TStringList; SchDoc : ISch_Document; const SchPath : String; SheetIndex : Integer);
var
    Iterator        : ISch_Iterator;
    Obj             : Variant;
    Component       : ISch_Component;
    CurrentComp     : ISch_Component;
    SheetId         : String;
    SheetName       : String;
    ObjIndex        : Integer;
    Oid             : Integer;
    ComponentIndex  : Integer;
    OffsetFromComp  : Integer;
    ClusterId       : String;
    TargetRole      : String;
    ExpectedKind    : String;
    CompDesignator  : String;
    CompComment     : String;
    CompLibRef      : String;
    DisplayX        : Integer;
    DisplayY        : Integer;
    DisplayOrient   : Integer;
    GeometrySource  : String;
    NativeX1        : Integer;
    NativeY1        : Integer;
    NativeX2        : Integer;
    NativeY2        : Integer;
    NativeStatus    : String;
    NativeSource    : String;
    ProbeRouteA     : String;
    ProbeRouteB     : String;
    ProbeRouteC     : String;
    ProbeRouteD     : String;
    RecommendedNext : String;
    InterfaceMatrix : String;
    CompileRiskPlan : String;
    Key             : String;
begin
    SheetId := 'SHEET_' + IntToStr(SheetIndex);
    SheetName := ChangeFileExt(ExtractFileName(SchPath), '');
    if SheetName = '' then
        SheetName := ChangeFileExt(ExtractFileName(SchDoc.DocumentName), '');

    Iterator := SchDoc.SchIterator_Create;
    if Iterator = nil then Exit;

    ObjIndex := 0;
    ComponentIndex := -1;
    OffsetFromComp := -1;
    CurrentComp := nil;
    CompDesignator := '';
    CompComment := '';
    CompLibRef := '';

    Obj := Iterator.FirstSchObject;
    while Obj <> nil do
    begin
        Oid := ProbeTryObjectId(Obj);

        if Oid = 26 then
        begin
            Inc(ComponentIndex);
            OffsetFromComp := 0;
            Component := Obj;
            CurrentComp := Component;
            CompDesignator := '';
            CompComment := '';
            CompLibRef := '';
            if CurrentComp <> nil then
            begin
                try
                    CompDesignator := CurrentComp.Designator.Text;
                except
                    CompDesignator := 'READ_ERROR';
                end;
                try
                    CompComment := CurrentComp.Comment.Text;
                except
                    CompComment := 'READ_ERROR';
                end;
                try
                    CompLibRef := CurrentComp.LibReference;
                except
                    CompLibRef := 'READ_ERROR';
                end;
            end;
        end
        else if ComponentIndex >= 0 then
            Inc(OffsetFromComp);

        if V58IsTarget(Oid) then
        begin
            TargetRole := V58DecisionForObjectId(Oid);
            ExpectedKind := V58ExpectedTextKindForObjectId(Oid);

            if ComponentIndex >= 0 then
                ClusterId := SheetId + '_COMPCLUSTER_' + IntToStr(ComponentIndex)
            else
                ClusterId := SheetId + '_PRECOMPONENT';

            Key := IntToStr(Oid) + ' ' + TargetRole + ' expected=' + ExpectedKind;
            ProbeIncCounter(Counters, Key);

            DisplayX := 0;
            DisplayY := 0;
            DisplayOrient := -1;
            GeometrySource := 'none';
            NativeX1 := 0;
            NativeY1 := 0;
            NativeX2 := 0;
            NativeY2 := 0;
            NativeStatus := 'notAttempted';
            NativeSource := 'none';
            ProbeRouteA := 'componentIteratorContext_ACTIVE';
            ProbeRouteB := 'nativeTypedAccess_BATCH_A_ACTIVE';
            ProbeRouteC := 'libRefGrouping_ACTIVE';
            ProbeRouteD := 'pinBoundsFallback_ACTIVE';
            RecommendedNext := 'keepAsAnchor';
            if Oid = 44 then
            begin
                RecommendedNext := 'analyzeBatchAResultsThenEnableNextTypedBatchOrChildIterator';
                ProbeRouteB := 'typedBatchA_ACTIVE:ISch_Line,ISch_Rectangle,ISch_Arc';
            end;
            if Oid = 4 then
                RecommendedNext := 'mapAsPossiblePrimitiveOrAnchorAroundComponent';
            if Oid = 25 then
                RecommendedNext := 'comparePrimaryDisplayAgainstDesignatorObject45';
            if (Oid = 45) or (Oid = 46) then
                RecommendedNext := 'validatedTextAnchor';

            InterfaceMatrix := V58InterfaceMatrixForObjectId(Oid);
            CompileRiskPlan := V58CompileRiskPlanForObjectId(Oid);

            if Oid = 44 then
            begin
                V58TryTypedBatchASymbolPrimitive(Obj, NativeX1, NativeY1, NativeX2, NativeY2, NativeStatus);
                NativeSource := 'typedBatchA_ISch_Line_Rectangle_Arc';
            end;
            if CurrentComp <> nil then
            begin
                if Oid = 46 then
                begin
                    DisplayX := TryCompCommentX(CurrentComp, CurrentComp.Location.X);
                    DisplayY := TryCompCommentY(CurrentComp, CurrentComp.Location.Y);
                    DisplayOrient := TryCompCommentOrientation(CurrentComp);
                    GeometrySource := 'ISch_Component.Comment.Location';
                end
                else if (Oid = 4) or (Oid = 44) then
                begin
                    DisplayX := CurrentComp.Location.X;
                    DisplayY := CurrentComp.Location.Y;
                    DisplayOrient := -1;
                    if (Oid = 44) and ((NativeStatus = 'ISch_Line_CAST_OK_GEOMETRY_NOT_READ_V58') or (NativeStatus = 'ISch_Rectangle_CAST_OK_GEOMETRY_NOT_READ_V58') or (NativeStatus = 'ISch_Arc_CAST_OK_GEOMETRY_NOT_READ_V58')) then
                    begin
                        GeometrySource := 'typedBatchA_castOnly:' + NativeStatus;
                    end
                    else
                        GeometrySource := 'componentContextOnly_nativePrimitiveGeometryNotRead';
                end
                else
                begin
                    DisplayX := TryCompDesignatorX(CurrentComp, CurrentComp.Location.X);
                    DisplayY := TryCompDesignatorY(CurrentComp, CurrentComp.Location.Y);
                    DisplayOrient := TryCompDesignatorOrientation(CurrentComp);
                    if Oid = 25 then
                        GeometrySource := 'primaryCandidateUsesDesignatorGeometry'
                    else
                        GeometrySource := 'ISch_Component.Designator.Location';
                end;
            end;

            Csv.Add(
                ProbeEscapeCell(SheetId) + ';' +
                ProbeEscapeCell(SheetName) + ';' +
                ProbeEscapeCell(SchPath) + ';' +
                IntToStr(ObjIndex) + ';' +
                ProbeEscapeCell(ClusterId) + ';' +
                IntToStr(ComponentIndex) + ';' +
                IntToStr(OffsetFromComp) + ';' +
                IntToStr(Oid) + ';' +
                ProbeEscapeCell(ProbeKnownObjectIdName(Oid)) + ';' +
                ProbeEscapeCell(TargetRole) + ';' +
                ProbeEscapeCell(ExpectedKind) + ';' +
                ProbeEscapeCell(CompDesignator) + ';' +
                ProbeEscapeCell(CompComment) + ';' +
                ProbeEscapeCell(CompLibRef) + ';' +
                IntToStr(DisplayX) + ';' +
                IntToStr(DisplayY) + ';' +
                IntToStr(DisplayOrient) + ';' +
                ProbeEscapeCell(GeometrySource) + ';' +
                IntToStr(NativeX1) + ';' +
                IntToStr(NativeY1) + ';' +
                IntToStr(NativeX2) + ';' +
                IntToStr(NativeY2) + ';' +
                ProbeEscapeCell(NativeStatus) + ';' +
                ProbeEscapeCell(NativeSource) + ';' +
                ProbeEscapeCell(ProbeRouteA) + ';' +
                ProbeEscapeCell(ProbeRouteB) + ';' +
                ProbeEscapeCell(ProbeRouteC + ': ' + CompLibRef) + ';' +
                ProbeEscapeCell(ProbeRouteD) + ';' +
                ProbeEscapeCell(InterfaceMatrix) + ';' +
                ProbeEscapeCell(CompileRiskPlan) + ';' +
                ProbeEscapeCell(RecommendedNext)
            );
        end;

        Inc(ObjIndex);
        Obj := Iterator.NextSchObject;
    end;

    SchDoc.SchIterator_Destroy(Iterator);
end;

procedure ExportSchV58LineVertexProbeReport;
var
    Workspace   : IWorkSpace;
    Project     : IProject;
    Document    : IDocument;
    SchDoc      : ISch_Document;
    Csv         : TStringList;
    Summary     : TStringList;
    Counters    : TStringList;
    i           : Integer;
    SheetCount  : Integer;
    Ext         : String;
    CsvPath     : String;
    SummaryPath : String;
begin
    Workspace := GetWorkSpace;
    if Workspace = nil then begin AppendExportLog('SCH v58 typed ISch_Line GetState_Vertex geometry probe skipped: no workspace'); Exit; end;
    Project := Workspace.DM_FocusedProject;
    if Project = nil then begin AppendExportLog('SCH v58 typed ISch_Line GetState_Vertex geometry probe skipped: no focused project'); Exit; end;

    Csv := TStringList.Create;
    Summary := TStringList.Create;
    Counters := TStringList.Create;
    try
        Csv.Add('sheetId;sheetName;sheetPath;objectIndex;componentClusterId;componentIndex;offsetFromComponent;objectId;knownType;v58RoleDecision;expectedKindOrPrimitiveRole;componentDesignatorText;componentCommentText;componentLibRef;displayX;displayY;displayOrientation;geometrySource;nativeX1;nativeY1;nativeX2;nativeY2;nativeStatus;nativeSource;probeRouteA_componentContext;probeRouteB_object44TypedAccess;probeRouteC_libRefGrouping;probeRouteD_fallbackQuality;lineGeometryProbe_v58;batchResultPlan_v58;recommendedNextAction');
        Summary.Add('Altium schematic v58 typed ISch_Line GetState_Vertex geometry probe embedded in ExportDesignData');
        Summary.Add('Version=' + SCRIPT_VERSION);
        Summary.Add('Schema=' + SCHEMA_VERSION);
        Summary.Add('Project=' + Project.DM_ProjectFullPath);
        Summary.Add('OutputFolder=' + GetProjectPath);
        Summary.Add('Purpose=v58 targeted geometry probe after v57b proved ObjectId 44 casts as ISch_Line; reads only ISch_Line.GetState_Vertex(0/1), while keeping Rectangle/Arc cast-only fallback and preserving all failure history.');
        Summary.Add('SafeProperties=ObjectId and iterator order; ObjectId 44 generic properties remain disabled; v58 tests one typed geometry route only: ISch_Line.GetState_Vertex(0/1).');
        Summary.Add('CsvColumns=sheetId;sheetName;sheetPath;objectIndex;componentClusterId;componentIndex;offsetFromComponent;objectId;knownType;v58RoleDecision;expectedKindOrPrimitiveRole;componentDesignatorText;componentCommentText;componentLibRef;displayX;displayY;displayOrientation;geometrySource;nativeX1;nativeY1;nativeX2;nativeY2;nativeStatus;nativeSource;probeRouteA_componentContext;probeRouteB_object44TypedAccess;probeRouteC_libRefGrouping;probeRouteD_fallbackQuality;lineGeometryProbe_v58;batchResultPlan_v58;recommendedNextAction');
        Summary.Add('');

        SheetCount := 0;
        for i := 0 to Project.DM_LogicalDocumentCount - 1 do
        begin
            Document := Project.DM_LogicalDocuments(i);
            Ext := AnsiUpperCase(ExtractFileExt(Document.DM_FullPath));
            if Ext = '.SCHDOC' then
            begin
                SchDoc := LoadSchDocumentByPath(Document.DM_FullPath);
                if SchDoc <> nil then
                begin
                    V58LineVertexProbeDumpSchDocument(Csv, Counters, SchDoc, Document.DM_FullPath, SheetCount);
                    Inc(SheetCount);
                end;
            end;
        end;

        Summary.Add('SheetCount=' + IntToStr(SheetCount));
        Summary.Add('[V58_LINE_GETSTATE_VERTEX_GEOMETRY_PROBE_COUNTS]');
        Counters.Sort;
        for i := 0 to Counters.Count - 1 do
            Summary.Add('  ' + Counters.Strings[i]);
        Summary.Add('');
        Summary.Add('[INTERPRETATION]');
        Summary.Add('ObjectId 44 / 4 rows are now included to map native symbol body candidates by component cluster.');
        Summary.Add('ObjectId 45 and 46 remain included as anchors to verify designator/comment context.');
        Summary.Add('ObjectId 25 remains the primary display object candidate and can be compared against 45/46 by cluster.');
        Summary.Add('ObjectId 44 generic geometry remains disabled; v58 actively tries ISch_Line.GetState_Vertex(0/1) only.');
        Summary.Add('Next step after v58: if GetState_Vertex compiles and fills coordinates, inject these line primitives into symbolGraphics; otherwise try one next ISch_Line property route.');

        CsvPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_v58_line_getstate_vertex_probe.csv');
        SummaryPath := GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_v58_line_getstate_vertex_probe_summary.txt');
        Csv.SaveToFile(CsvPath);
        Summary.SaveToFile(SummaryPath);
        AppendExportLog('Saved SCH v58 typed ISch_Line GetState_Vertex geometry probe CSV: ' + CsvPath);
        AppendExportLog('Saved SCH v58 typed ISch_Line GetState_Vertex geometry probe summary: ' + SummaryPath);
    finally
        Csv.Free;
        Summary.Free;
        Counters.Free;
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
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, PCB_OUTPUT_SUFFIX));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_schematic.json'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + 'export_design_data_debug.txt');
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_v58_line_getstate_vertex_probe.csv'));
        OutputFileNames.Add(GetProjectPath + TargetPrefix + ChangeFileExt(TargetFileName, '_sch_v58_line_getstate_vertex_probe_summary.txt'));
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

    AppendExportLog('--- Generate called ' + SCRIPT_VERSION + ' / ' + SCHEMA_VERSION + ' ---');
    AppendExportLog('Parameters: ' + Parameters);
    AppendExportLog('Output folder: ' + GetProjectPath);

    ParamUpper := AnsiUpperCase(Parameters);

    if Pos('PCB', ParamUpper) > 0 then
        ExportProjectPcbToJson
    else if Pos('SCH', ParamUpper) > 0 then
    begin
        ExportAllProjectSchToJson;
        ExportSchV58LineVertexProbeReport;
    end
    else if Pos('BOM', ParamUpper) > 0 then
        ExportProjectBomToJson
    else
    begin
        ExportWholeProjectToJson;
        ExportSchV58LineVertexProbeReport;
    end;

    AppendExportLog('--- Generate finished ' + SCRIPT_VERSION + ' ---');
end;

procedure RunScript;
begin
    Generate('');
    ShowMessage('Export JSON ' + SCRIPT_VERSION + ' termine dans : ' + GetProjectPath);
end;

function Run(Parameters : String) : String;
begin
    Generate(Parameters);
    Result := 'Success';
end;