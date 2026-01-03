#!/bin/bash

# ioBroker Nebenkosten-Monitor Update Script
# Dieses Skript updated den Adapter auf deinem ioBroker-System

set -e  # Exit on error

echo "🚀 ioBroker Nebenkosten-Monitor Update"
echo "======================================"
echo ""

# Farben für Output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Prüfe ob wir auf dem ioBroker-System sind
if [ ! -d "/opt/iobroker" ]; then
    echo -e "${RED}❌ Fehler: /opt/iobroker nicht gefunden${NC}"
    echo ""
    echo "Dieses Skript muss auf dem ioBroker-System ausgeführt werden!"
    echo ""
    echo "Führe es so aus:"
    echo "  1. SSH zu deinem ioBroker: ssh user@iobroker-ip"
    echo "  2. Kopiere dieses Skript auf den Server"
    echo "  3. Führe es aus: bash update-adapter.sh"
    echo ""
    echo "ODER verwende die Remote-Installation:"
    echo "  ssh user@iobroker-ip 'bash -s' < update-adapter.sh"
    exit 1
fi

echo -e "${YELLOW}Schritt 1: Adapter stoppen...${NC}"
iobroker stop nebenkosten-monitor
sleep 2

echo -e "${YELLOW}Schritt 2: Alte Version deinstallieren...${NC}"
cd /opt/iobroker
npm uninstall iobroker.nebenkosten-monitor || true

echo -e "${YELLOW}Schritt 3: Neue Version von GitHub installieren...${NC}"
npm install https://github.com/fischi87/ioBroker.nebenkosten-monitor/tarball/main

echo -e "${YELLOW}Schritt 4: Adapter hochladen...${NC}"
iobroker upload nebenkosten-monitor

echo -e "${YELLOW}Schritt 5: Adapter starten...${NC}"
iobroker start nebenkosten-monitor

echo ""
echo -e "${GREEN}✅ Update erfolgreich abgeschlossen!${NC}"
echo ""
echo "📋 Nächste Schritte:"
echo "  1. Öffne die Admin-UI: http://deine-iobroker-ip:8081"
echo "  2. Gehe zu Instanzen → nebenkosten-monitor"
echo "  3. Klicke auf das Zahnrad (Konfiguration)"
echo "  4. Du siehst jetzt 4 neue Tabs: Gas, Wasser, Strom, Info"
echo "  5. Konfiguriere deine Sensoren und Preise"
echo ""
echo "🔍 Status prüfen:"
echo "  iobroker status nebenkosten-monitor"
echo ""
echo "📊 Log anschauen:"
echo "  iobroker logs --watch"
echo ""
