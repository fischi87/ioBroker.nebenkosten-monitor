# Installation & Update Anleitung

## 🔧 Voraussetzungen

- ioBroker installiert unter `/opt/iobroker`
- SSH-Zugriff zu deinem ioBroker-System
- Node.js auf dem ioBroker-System

## 📥 Installation / Update

### **Methode 1: Mit Update-Skript (Empfohlen)**

#### Auf dem ioBroker-System direkt:

```bash
# 1. Skript auf das ioBroker-System kopieren
scp update-adapter.sh user@iobroker-ip:/tmp/

# 2. SSH zum ioBroker-System
ssh user@iobroker-ip

# 3. Skript ausführen
sudo bash /tmp/update-adapter.sh
```

#### Von deinem Mac aus (Remote):

```bash
# Führe das Skript direkt remote aus
ssh user@iobroker-ip 'bash -s' < update-adapter.sh
```

### **Methode 2: Manuelle Installation**

SSH zum ioBroker-System und führe aus:

```bash
# Adapter stoppen
iobroker stop nebenkosten-monitor

# In ioBroker-Verzeichnis wechseln
cd /opt/iobroker

# Alte Version deinstallieren (falls vorhanden)
npm uninstall iobroker.nebenkosten-monitor

# Neue Version installieren
npm install https://github.com/fischi87/ioBroker.nebenkosten-monitor/tarball/main

# Adapter hochladen
iobroker upload nebenkosten-monitor

# Adapter starten
iobroker start nebenkosten-monitor
```

### **Methode 3: Über die Admin-UI**

1. Öffne ioBroker Admin: `http://deine-iobroker-ip:8081`
2. Gehe zu **Adapter**
3. Klicke auf **Installieren von Custom URL** (GitHub-Icon)
4. Gib ein: `fischi87/ioBroker.nebenkosten-monitor`
5. Klicke auf **Installieren**

## ⚙️ Konfiguration nach Installation

1. **Admin-UI öffnen**
2. Gehe zu **Instanzen**
3. Finde `nebenkosten-monitor.0`
4. Klicke auf das **Zahnrad** (Konfiguration)

### Gas konfigurieren:

1. Tab **Gas** öffnen
2. ☑️ **Gas-Überwachung aktivieren**
3. **Datenpunkt Gaszähler** auswählen (z.B. von Shelly)
4. **Aktueller Zählerstand** eintragen (vom physischen Gaszähler)
5. **Brennwert** eintragen (z.B. 11.5 - findest du auf deiner Gasrechnung)
6. **Z-Zahl** eintragen (z.B. 0.95 - findest du auf deiner Gasrechnung)
7. **Preise** hinzufügen:
    - Klicke auf **+** (Zeile hinzufügen)
    - **Gültig ab**: z.B. 01.01.2025
    - **Preis**: z.B. 0.12 €/kWh
    - **Grundgebühr**: z.B. 8.99 €/Monat

### Wasser konfigurieren:

1. Tab **Wasser** öffnen
2. ☑️ **Wasser-Überwachung aktivieren**
3. **Datenpunkt Wasserzähler** auswählen
4. **Aktueller Zählerstand** eintragen
5. **Preise** hinzufügen

### Strom konfigurieren:

1. Tab **Strom** öffnen
2. ☑️ **Strom-Überwachung aktivieren**
3. **Datenpunkt Stromzähler** auswählen
4. **Aktueller Zählerstand** eintragen
5. **Preise** hinzufügen

## 📊 Datenpunkte prüfen

Nach der Konfiguration solltest du diese Struktur sehen:

```
nebenkosten-monitor.0.
├── gas/
│   ├── consumption/ (current, daily, monthly, yearly)
│   ├── costs/ (total, daily, monthly, yearly, basicCharge)
│   ├── info/ (meterReading, currentPrice, lastSync)
│   └── statistics/ (averageDaily, averageMonthly)
├── water/ (gleiche Struktur)
└── electricity/ (gleiche Struktur)
```

## 🔍 Troubleshooting

### Adapter startet nicht

```bash
# Log ansehen
iobroker logs --watch

# Status prüfen
iobroker status nebenkosten-monitor

# Adapter neu starten
iobroker restart nebenkosten-monitor
```

### Sensor liefert keine Werte

1. Prüfe, ob `info.sensorActive` auf `true` steht
2. Prüfe im Log nach Fehlermeldungen
3. Stelle sicher, dass der Sensor-Datenpunkt korrekt ist

### Kosten werden nicht berechnet

1. Prüfe, ob Preise konfiguriert sind (Tab Gas/Wasser/Strom)
2. Das Gültigkeitsdatum muss in der Vergangenheit liegen
3. Prüfe `info.currentPrice` - sollte > 0 sein

### States werden nicht erstellt

```bash
# Adapter neu starten und Log beobachten
iobroker restart nebenkosten-monitor
iobroker logs --watch
```

## 🎯 Nächste Schritte

1. **Teste den Adapter**: Warte ein paar Minuten und schaue, ob sich die Werte aktualisieren
2. **Visualisierung**: Nutze die Datenpunkte in deiner Vis oder Grafana
3. **Benachrichtigungen**: Erstelle Szenen für Warnungen bei hohem Verbrauch
4. **Backup**: Sichere deine Konfiguration regelmäßig

## 📞 Support

- **GitHub Issues**: https://github.com/fischi87/ioBroker.nebenkosten-monitor/issues
- **README**: https://github.com/fischi87/ioBroker.nebenkosten-monitor#readme
