@echo off
:: ============================================================
::  QZ Tray - instalar o certificado do Grupo Amicia como
::  CONFIAVEL (override.crt). Depois disso: ZERO avisos,
::  nem o primeiro. Rodar como ADMINISTRADOR (botao direito).
:: ============================================================
title Grupo Amicia - certificado confiavel no QZ Tray

set "QZDIR=%ProgramFiles%\QZ Tray"
if not exist "%QZDIR%" set "QZDIR=%ProgramFiles(x86)%\QZ Tray"
if not exist "%QZDIR%" (
  echo [ERRO] Nao achei a pasta do QZ Tray. Instala o QZ primeiro.
  pause
  exit /b 1
)

echo Baixando o certificado do APP Financeiro...
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing 'https://app-financeiro-brown.vercel.app/qz-cert.crt' -OutFile '%QZDIR%\override.crt'"
if not exist "%QZDIR%\override.crt" (
  echo [ERRO] Download falhou. Confere a internet e tenta de novo.
  pause
  exit /b 1
)

echo Reiniciando o QZ Tray...
taskkill /f /im qz-tray.exe >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%QZDIR%\qz-tray.exe"

echo.
echo ============================================================
echo  PRONTO! O certificado "APP Financeiro Grupo Amicia" agora
echo  e CONFIAVEL no QZ. Recarrega o app no Chrome e imprime -
echo  nao deve aparecer mais nenhum aviso.
echo ============================================================
pause
