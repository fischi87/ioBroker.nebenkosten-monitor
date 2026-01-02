![Logo](admin/nebenkosten-monitor.png)

# ioBroker.nebenkosten-monitor

[![NPM version](https://img.shields.io/npm/v/iobroker.nebenkosten-monitor.svg)](https://www.npmjs.com/package/iobroker.nebenkosten-monitor)
[![Downloads](https://img.shields.io/npm/dm/iobroker.nebenkosten-monitor.svg)](https://www.npmjs.com/package/iobroker.nebenkosten-monitor)
![Number of Installations](https://iobroker.live/badges/nebenkosten-monitor-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/nebenkosten-monitor-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.nebenkosten-monitor.png?downloads=true)](https://nodei.co/npm/iobroker.nebenkosten-monitor/)

**Tests:** ![Test and Release](https://github.com/fischi87/ioBroker.nebenkosten-monitor/workflows/Test%20and%20Release/badge.svg)

## Nebenkosten-Monitor Adapter für ioBroker

Überwacht Gas-, Wasser- und Stromverbrauch mit automatischer Kostenberechnung und detaillierten Statistiken.

### Hauptfunktionen

- 📊 **Verbrauchsüberwachung** für Gas, Wasser und Strom
- 💰 **Automatische Kostenberechnung** basierend auf konfigurierbaren Preishistorien
- 🔄 **Flexible Datenpunkte** - nutzt vorhandene Sensor-Datenpunkte (Shelly, Tasmota, Homematic, etc.)
- 📈 **Statistiken** - täglich, monatlich und jährlich
- ⚡ **Gas-Spezial** - Automatische Umrechnung von m³ in kWh mit Brennwert und Z-Zahl
- 🔔 **Preisverwaltung** - Unterstützt Preisänderungen mit Gültigkeitsdatum
- 💵 **Grundgebühren** - Berücksichtigt monatliche Grundgebühren in der Kostenrechnung

### Installation

1. Adapter über die ioBroker Admin-Oberfläche installieren
2. Instanz erstellen
3. Konfiguration öffnen

### Konfiguration

#### Gas-Überwachung

1. **Aktivierung**: Gas-Überwachung aktivieren
2. **Sensor-Datenpunkt**: Wählen Sie den Datenpunkt Ihres Gaszählers (m³)
3. **Zählerstand**: Tragen Sie den aktuellen Zählerstand am physischen Gerät ein
4. **Brennwert**: Wert von Ihrem Gasversorger (typisch 10-12 kWh/m³)
5. **Z-Zahl**: Zustandszahl von Ihrem Gasversorger (typisch 0.90-1.00)
6. **Preise**: Fügen Sie Preise mit Gültigkeitsdatum hinzu

**Beispiel:**

- Gültig ab: 01.01.2025
- Preis: 0.12 €/kWh
- Grundgebühr: 8.99 €/Monat

#### Wasser-Überwachung

1. **Aktivierung**: Wasser-Überwachung aktivieren
2. **Sensor-Datenpunkt**: Wählen Sie den Datenpunkt Ihres Wasserzählers (m³)
3. **Zählerstand**: Tragen Sie den aktuellen Zählerstand ein
4. **Preise**: Fügen Sie Preise mit Gültigkeitsdatum hinzu

#### Strom-Überwachung

1. **Aktivierung**: Strom-Überwachung aktivieren
2. **Sensor-Datenpunkt**: Wählen Sie den Datenpunkt Ihres Stromzählers (kWh)
3. **Zählerstand**: Tragen Sie den aktuellen Zählerstand ein
4. **Preise**: Fügen Sie Preise mit Gültigkeitsdatum hinzu

### Datenpunkte

Der Adapter erstellt für jede aktivierte Verbrauchsart folgende Struktur:

#### Verbrauch (consumption)

- `current` - Aktueller Zählerstand
- `daily` - Tagesverbrauch (wird um Mitternacht zurückgesetzt)
- `monthly` - Monatsverbrauch (wird am 1. des Monats zurückgesetzt)
- `yearly` - Jahresverbrauch (wird am 1. Januar zurückgesetzt)
- `lastUpdate` - Zeitstempel der letzten Aktualisierung

#### Kosten (costs)

- `total` - Gesamtkosten (Jahresverbrauch + 12× Grundgebühr)
- `daily` - Kosten heute
- `monthly` - Kosten diesen Monat
- `yearly` - Kosten dieses Jahr
- `basicCharge` - Aktuelle monatliche Grundgebühr

#### Informationen (info)

- `meterReading` - Zählerstand (in kWh für Gas/Strom, m³ für Wasser)
- `meterReadingVolume` - Zählerstand in m³ (nur bei Gas)
- `currentPrice` - Aktueller Preis pro Einheit
- `lastSync` - Letzte Synchronisation
- `sensorActive` - Sensor verbunden und aktiv

#### Statistiken (statistics)

- `averageDaily` - Durchschnittlicher Tagesverbrauch
- `averageMonthly` - Durchschnittlicher Monatsverbrauch
- `lastDayStart` - Zeitpunkt des letzten Tages-Resets
- `lastMonthStart` - Zeitpunkt des letzten Monats-Resets
- `lastYearStart` - Zeitpunkt des letzten Jahres-Resets

### Beispiel-Konfigurationen

#### Gas mit Shelly Plus 1PM (Impulszähler)

1. Shelly als Impulszähler am Gaszähler montieren
2. In ioBroker: Shelly-Impulszähler-Datenpunkt auswählen
3. Brennwert und Z-Zahl vom Gasversorger eintragen
4. Adapter rechnet automatisch m³ → kWh um

#### Wasser mit Homematic HM-Sen-Wa-Od

1. Homematic Wassersensor installieren
2. Datenpunkt für m³ auswählen
3. Aktuellen Zählerstand eintragen
4. Preise konfigurieren

#### Strom mit Shelly 3EM

1. Shelly 3EM installiert
2. Datenpunkt für kWh-Zähler auswählen
3. Aktuellen Zählerstand ablesen und eintragen
4. Strompreis konfigurieren

### Preisverwaltung

Der Adapter unterstützt Preisänderungen über die Zeit:

1. **Mehrere Preise** können mit Gültigkeitsdatum hinzugefügt werden
2. Der Adapter wählt automatisch den **aktuell gültigen Preis**
3. Bei Preisänderung einfach neuen Eintrag mit neuem Datum hinzufügen
4. **Grundgebühren** werden separat erfasst

**Beispiel:**

```
Gültig ab: 01.01.2024 | Preis: 0.10 €/kWh | Grundgebühr: 7.99 €
Gültig ab: 01.07.2024 | Preis: 0.12 €/kWh | Grundgebühr: 8.99 €
Gültig ab: 01.01.2025 | Preis: 0.11 €/kWh | Grundgebühr: 8.99 €
```

### Gas: m³ → kWh Umrechnung

Gasverbrauch wird in m³ gemessen, aber in kWh abgerechnet.

**Formel:** `kWh = m³ × Brennwert × Z-Zahl`

**Beispiel:**

- Verbrauch: 100 m³
- Brennwert: 11.5 kWh/m³
- Z-Zahl: 0.95
- **Ergebnis:** 100 × 11.5 × 0.95 = 1,092.5 kWh

Die Werte für Brennwert und Z-Zahl finden Sie auf Ihrer Gasrechnung oder beim Gasversorger.

### Automatische Resets

- **Täglich** um Mitternacht: `daily` Werte werden zurückgesetzt
- **Monatlich** am 1. des Monats: `monthly` Werte werden zurückgesetzt
- **Jährlich** am 1. Januar: `yearly` Werte werden zurückgesetzt

### Troubleshooting

#### Sensor liefert keine Werte

1. Prüfen Sie, ob der Sensor-Datenpunkt korrekt ist
2. Schauen Sie im Log nach Fehlermeldungen
3. Prüfen Sie, ob `info.sensorActive` auf `true` steht

#### Kosten werden nicht berechnet

1. Stellen Sie sicher, dass Preise konfiguriert sind
2. Das Gültigkeitsdatum muss in der Vergangenheit liegen
3. Prüfen Sie `info.currentPrice` - sollte > 0 sein

#### Gas-Umrechnung stimmt nicht

1. Prüfen Sie Brennwert und Z-Zahl
2. Diese Werte können regional unterschiedlich sein
3. Werte finden Sie auf der Gasrechnung

#### Zählerstand weicht ab

1. Tragen Sie den aktuellen Zählerstand im Feld "Zählerstand am Gerät" ein
2. Der Adapter synchronisiert daraufhin die Werte

### Changelog

#### 0.0.1 (2025-01-02)

- (fischi87) Initial release
- Gas-Überwachung mit kWh-Umrechnung
- Wasser-Überwachung
- Strom-Überwachung
- Kostenberechnung mit Preishistorie
- Tages-, Monats- und Jahresstatistiken
- Automatische Resets

## License

MIT License

Copyright (c) 2025 fischi87 <axel.fischer@hotmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
