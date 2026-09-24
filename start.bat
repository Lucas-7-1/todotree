@echo off
chcp 65001 >nul
title TodoTree

cd /d "%~dp0"

if exist "%~dp0TodoTree.exe" (
    start "" "%~dp0TodoTree.exe"
    exit
)

if exist "%~dp0todotree\TodoTree.exe" (
    start "" "%~dp0todotree\TodoTree.exe"
    exit
)

if exist "%~dp0TodoTree_一键直达.html" (
    start "" "%~dp0TodoTree_一键直达.html"
    exit
)

echo 未找到 TodoTree 可执行程序或 HTML 文件。
pause
