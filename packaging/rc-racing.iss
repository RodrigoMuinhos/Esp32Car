; RC Racing installer (Inno Setup 6). Built by scripts\build-installer.ps1.
; Installs the app for all users plus the ESP32 USB driver (Silicon Labs CP210x,
; WHQL-signed), so the board is recognized on a new PC.
#define AppName "RC Racing"
#define AppVersion "1.1.0"
#define AppExe "RC Racing.exe"
#define AppIdGuid "6F0E2B71-3C8A-4E5B-9A4D-2C7B1E8F9A10"

[Setup]
AppId={{{#AppIdGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=RC Racing
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Administrator rights are needed to install the board driver.
PrivilegesRequired=admin
OutputDir=..\installer
OutputBaseFilename=RC-Racing-Setup
SetupIconFile=rc-racing.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos:"
Name: "driver"; Description: "Instalar o driver USB da placa ESP32 (CP210x)"; GroupDescription: "Placa:"

[Files]
Source: "..\build\pyinstaller\dist\{#AppName}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "drivers\cp210x\*"; DestDir: "{app}\drivers\cp210x"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"
Name: "{autoprograms}\{#AppName}\{#AppName} - Diagnóstico"; Filename: "{app}\{#AppExe}"; Parameters: "--diagnostico"; IconFilename: "{app}\{#AppExe}"
Name: "{autoprograms}\{#AppName}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{sys}\pnputil.exe"; Parameters: "/add-driver ""{app}\drivers\cp210x\silabser.inf"" /install"; StatusMsg: "Instalando o driver da placa ESP32..."; Flags: runhidden waituntilterminated; Tasks: driver
Filename: "{app}\{#AppExe}"; Parameters: "--diagnostico"; Description: "Verificar placa e volante agora (diagnóstico)"; Flags: nowait postinstall skipifsilent unchecked runasoriginaluser
Filename: "{app}\{#AppExe}"; Description: "Abrir o {#AppName} agora"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\{#AppName}"

[Code]
{ Versions up to 1.0 installed per user; remove that copy so only one remains. }
function InitializeSetup(): Boolean;
var
  Uninstall: String;
  Code: Integer;
begin
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppIdGuid}}_is1',
    'UninstallString', Uninstall) then
    Exec(RemoveQuotes(Uninstall), '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE,
      ewWaitUntilTerminated, Code);
  Result := True;
end;
