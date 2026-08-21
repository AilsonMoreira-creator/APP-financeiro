@echo off
title Grupo Amicia - certificado confiavel no QZ Tray
echo.
echo === 1/4  Procurando a pasta do QZ Tray...
set "QZDIR="
set "PF86=%ProgramFiles(x86)%"
if exist "%ProgramFiles%\QZ Tray\qz-tray.exe" set "QZDIR=%ProgramFiles%\QZ Tray"
if not defined QZDIR if exist "%PF86%\QZ Tray\qz-tray.exe" set "QZDIR=%PF86%\QZ Tray"
if not defined QZDIR if exist "%LocalAppData%\Programs\QZ Tray\qz-tray.exe" set "QZDIR=%LocalAppData%\Programs\QZ Tray"
if not defined QZDIR if exist "%LocalAppData%\QZ Tray\qz-tray.exe" set "QZDIR=%LocalAppData%\QZ Tray"
if defined QZDIR goto ACHOU
echo [ERRO] Nao achei o qz-tray.exe em nenhum caminho conhecido.
echo O QZ Tray esta instalado nesta maquina?
echo Manda uma foto desta tela pro Ailson.
pause
exit /b 1

:ACHOU
echo    Achei: %QZDIR%
echo.
echo === 2/4  Baixando o certificado do APP Financeiro...
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing 'https://app-financeiro-brown.vercel.app/qz-cert.crt' -OutFile '%TEMP%\qz-amicia.crt'"
if exist "%TEMP%\qz-amicia.crt" goto BAIXOU
echo [ERRO] Download falhou. Confere a internet e tenta de novo.
pause
exit /b 1

:BAIXOU
echo    [ok] certificado baixado
echo.
echo === 3/4  Instalando como confiavel...
copy /y "%TEMP%\qz-amicia.crt" "%QZDIR%\override.crt" >nul
if exist "%QZDIR%\override.crt" echo    [ok] override.crt gravado na pasta do QZ
if not exist "%QZDIR%\override.crt" echo    [FALHOU] sem permissao - rodou como ADMINISTRADOR?
set "PROPS=%QZDIR%\qz-tray.properties"
findstr /i /c:"authcert.override" "%PROPS%" >nul 2>&1
if not errorlevel 1 goto PROPSOK
echo authcert.override=%QZDIR:\=/%/override.crt>>"%PROPS%"
echo    [ok] authcert.override adicionado no qz-tray.properties
goto REINICIA

:PROPSOK
echo    [ok] qz-tray.properties ja tinha authcert.override

:REINICIA
echo.
echo === 4/4  Reiniciando o QZ Tray...
taskkill /f /im qz-tray.exe >nul 2>&1
taskkill /f /im javaw.exe >nul 2>&1
timeout /t 3 /nobreak >nul
start "" "%QZDIR%\qz-tray.exe"
echo.
echo ============================================================
echo  PRONTO. Confere:
echo    Pasta do QZ: %QZDIR%
if exist "%QZDIR%\override.crt" echo    override.crt: OK
if not exist "%QZDIR%\override.crt" echo    override.crt: FALTANDO - rodar de novo como ADM
if exist "%PROPS%" echo    properties: OK
echo.
echo  Agora: recarrega a pagina do APP (2x) e clica Testar QZ.
echo  Se o aviso ainda aparecer, manda foto DESTA tela pro Ailson.
echo ============================================================
pause
