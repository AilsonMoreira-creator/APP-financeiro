@echo off
:: ============================================================
::  QZ Tray - instalar o certificado do Grupo Amicia como
::  CONFIAVEL. Depois disso: ZERO avisos, nem o primeiro.
::  RODAR COMO ADMINISTRADOR (botao direito - Executar como adm)
::
::  v2 (21/08): procura o QZ em TODOS os caminhos de instalacao,
::  grava o override.crt E a linha authcert.override no
::  qz-tray.properties (os dois jeitos que o QZ aceita), e
::  mostra o diagnostico completo na tela.
:: ============================================================
title Grupo Amicia - certificado confiavel no QZ Tray
setlocal EnableDelayedExpansion

echo.
echo === 1/4  Procurando a pasta do QZ Tray...
set "QZDIR="
for %%D in ("%ProgramFiles%\QZ Tray" "%ProgramFiles(x86)%\QZ Tray" "%LocalAppData%\Programs\QZ Tray" "%LocalAppData%\QZ Tray") do (
  if exist "%%~D\qz-tray.exe" if not defined QZDIR set "QZDIR=%%~D"
)
if not defined QZDIR (
  echo [ERRO] Nao achei o qz-tray.exe em nenhum caminho conhecido:
  echo    - %ProgramFiles%\QZ Tray
  echo    - %ProgramFiles(x86)%\QZ Tray
  echo    - %LocalAppData%\Programs\QZ Tray
  echo    - %LocalAppData%\QZ Tray
  echo Manda uma foto desta tela pro Ailson.
  pause
  exit /b 1
)
echo    Achei: %QZDIR%

echo.
echo === 2/4  Baixando o certificado do APP Financeiro...
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing 'https://app-financeiro-brown.vercel.app/qz-cert.crt' -OutFile '%TEMP%\qz-amicia.crt'"
if not exist "%TEMP%\qz-amicia.crt" (
  echo [ERRO] Download falhou. Confere a internet e tenta de novo.
  pause
  exit /b 1
)

echo.
echo === 3/4  Instalando como confiavel (2 mecanismos)...
copy /y "%TEMP%\qz-amicia.crt" "%QZDIR%\override.crt" >nul
if exist "%QZDIR%\override.crt" (echo    [ok] override.crt gravado em %QZDIR%) else (echo    [FALHOU] sem permissao pra gravar em %QZDIR% - rodou como ADMINISTRADOR?)

:: qz-tray.properties: linha authcert.override apontando pro cert
set "PROPS=%QZDIR%\qz-tray.properties"
set "CRTPATH=%QZDIR:\=\\%\\override.crt"
if exist "%PROPS%" (
  findstr /i /c:"authcert.override" "%PROPS%" >nul 2>&1
  if errorlevel 1 (
    echo authcert.override=%CRTPATH%>>"%PROPS%"
    echo    [ok] authcert.override adicionado no qz-tray.properties
  ) else (
    echo    [ok] qz-tray.properties ja tinha authcert.override
  )
) else (
  echo authcert.override=%CRTPATH%>"%PROPS%"
  echo    [ok] qz-tray.properties criado com authcert.override
)

echo.
echo === 4/4  Reiniciando o QZ Tray...
taskkill /f /im qz-tray.exe >nul 2>&1
taskkill /f /im javaw.exe >nul 2>&1
timeout /t 3 /nobreak >nul
start "" "%QZDIR%\qz-tray.exe"

echo.
echo ============================================================
echo  PRONTO. Confere o resultado:
echo    Pasta do QZ ....... %QZDIR%
if exist "%QZDIR%\override.crt" (echo    override.crt ...... OK) else (echo    override.crt ...... FALTANDO - rodar de novo como ADM)
if exist "%PROPS%" (echo    properties ........ OK) else (echo    properties ........ FALTANDO)
echo.
echo  Agora: recarrega a pagina do APP (2x) e clica Testar QZ.
echo  Se aparecer o aviso ainda, manda foto DESTA tela pro Ailson.
echo ============================================================
pause
