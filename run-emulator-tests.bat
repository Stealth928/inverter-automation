@echo off
REM Test script for Firebase Functions Emulator
REM This script starts the emulator in a separate process and runs tests

echo ========================================
echo Firebase Functions Emulator Test Suite
echo ========================================
echo.

REM Start emulator in background
echo [1/3] Starting Firebase Functions Emulator...
start "Firebase Emulator" cmd /k "cd /d %cd% && firebase emulators:start --only functions --project inverter-automation-firebase"

REM Wait for emulator to start
timeout /t 5 /nobreak

REM Run tests
echo.
echo [2/3] Running end-to-end tests...
node test-emulator.js

REM Check result
if %errorlevel% equ 0 (
    echo.
    echo [3/3] All tests passed!
    echo.
    echo To stop the emulator, close the "Firebase Emulator" window or press Ctrl+C there.
    echo.
) else (
    echo.
    echo [3/3] Some tests failed. Check the output above.
    echo.
)

pause
