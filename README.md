![Logo](admin/nebenkosten-monitor.png)

# ioBroker.nebenkosten-monitor

[![NPM version](https://img.shields.io/npm/v/iobroker.nebenkosten-monitor.svg)](https://www.npmjs.com/package/iobroker.nebenkosten-monitor)
[![Downloads](https://img.shields.io/npm/dm/iobroker.nebenkosten-monitor.svg)](https://www.npmjs.com/package/iobroker.nebenkosten-monitor)
![Number of Installations](https://iobroker.live/badges/nebenkosten-monitor-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/nebenkosten-monitor-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.nebenkosten-monitor.png?downloads=true)](https://nodei.co/npm/iobroker.nebenkosten-monitor/)

**Tests:** ![Test and Release](https://github.com/fischi87/ioBroker.nebenkosten-monitor/workflows/Test%20and%20Release/badge.svg)

## Nebenkosten-Monitor Adapter für ioBroker

Überwacht Gas-, Wasser- und Stromverbrauch mit automatischer Kostenberechnung, Abschlagsüberwachung und detaillierten Statistiken.

### ✨ Hauptfunktionen

- 📊 **Verbrauchsüberwachung** für Gas, Wasser und Strom
- 💰 **Automatische Kostenberechnung** mit Arbeitspreis und Grundgebühr
- 💳 **Abschlagsüberwachung** - Sehe sofort ob Nachzahlung oder Guthaben droht
- 🔄 **Flexible Sensoren** - Nutzt vorhandene Sensoren (Shelly, Tasmota, Homematic, etc.)
- 📈 **Automatische Statistiken** - täglich, monatlich und jährlich
- ⚡ **Gas-Spezial** - Automatische Umrechnung von m³ in kWh
- 🕛 **Automatische Resets** - Täglich, monatlich und jährlich

---

## 🚀 Schnellstart

### 1. Installation

1. Adapter über die ioBroker Admin-Oberfläche installieren
2. Instanz erstellen
3. Konfiguration öffnen

### 2. Grundkonfiguration (Beispiel: Gas)

1. ✅ **Gas-Überwachung aktivieren**
2. 🔍 **Sensor auswählen** - Deinen Gaszähler-Sensor (in m³)
3. 📝 **Zählerstand bei Vertragsbeginn** - z.B. 10250 m³
4. 🔥 **Brennwert & Z-Zahl** - Von deiner Gasrechnung (z.B. 11,5 und 0,95)
5. 💶 **Preise eintragen**:
    - Arbeitspreis: 0,1835 €/kWh
    - Grundgebühr: 15,03 €/Monat
6. 💳 **Abschlag** - Monatliche Vorauszahlung (z.B. 150 €)

**Fertig!** Der Adapter berechnet nun automatisch alle Kosten! 🎉

---

## 📊 Datenpunkte erklärt

Für jede aktivierte Verbrauchsart (Gas/Wasser/Strom) werden folgende Ordner angelegt:

### 🗂️ **consumption** (Verbrauch)

| Datenpunkt        | Beschreibung                                    | Beispiel         |
| ----------------- | ----------------------------------------------- | ---------------- |
| `daily`           | Verbrauch **heute** (seit 00:00 Uhr)            | 12,02 kWh        |
| `dailyVolume`\*   | Verbrauch heute in m³ (nur Gas)                 | 1,092 m³         |
| `monthly`         | Verbrauch **diesen Monat** (seit 1. des Monats) | 117,77 kWh       |
| `monthlyVolume`\* | Monatlicher Verbrauch in m³ (nur Gas)           | 10,69 m³         |
| `yearly`          | Verbrauch **dieses Jahr** (seit 1. Januar)      | 730,01 kWh       |
| `yearlyVolume`\*  | Jahresverbrauch in m³ (nur Gas)                 | 66,82 m³         |
| `lastUpdate`      | Letzte Aktualisierung                           | 06.01.2026 14:11 |

_\*nur bei Gas verfügbar_

**💡 Tipp:** `yearly` wird automatisch aus `Aktueller Zählerstand - Initial Reading` berechnet!

---

### 💰 **costs** (Kosten)

| Datenpunkt    | Was ist das?                                                  | Berechnung                         | Beispiel                      |
| ------------- | ------------------------------------------------------------- | ---------------------------------- | ----------------------------- |
| `daily`       | Kosten **heute**                                              | daily × Arbeitspreis               | 2,27 €                        |
| `monthly`     | Kosten **diesen Monat**                                       | monthly × Arbeitspreis             | 21,61 €                       |
| `yearly`      | **Verbrauchskosten** seit Jahresbeginn                        | yearly × Arbeitspreis              | 137,61 €                      |
| `basicCharge` | **Grundgebühr akkumuliert**                                   | Grundgebühr × Monate               | 15,03 €                       |
| `paidTotal`   | **Bezahlt** via Abschlag                                      | Abschlag × Monate                  | 150,00 €                      |
| `balance`     | **🎯 WICHTIGSTER Wert!**<br>Nachzahlung (+) oder Guthaben (-) | (yearly + basicCharge) - paidTotal | **+2,64 €**<br>→ Nachzahlung! |

#### 🔍 **balance** genauer erklärt:

- **Positiv (+50 €)** → ❌ **Nachzahlung**: Du musst am Jahresende zahlen
- **Negativ (-24 €)** → ✅ **Guthaben**: Du bekommst Geld zurück
- **Null (0 €)** → ⚖️ **Ausgeglichen**: Verbrauch = Abschlag

**Beispiel:**

```
Verbrauchskosten:  137,61 € (yearly)
Grundgebühr:      + 15,03 € (basicCharge)
────────────────────────────
Gesamtkosten:      152,64 €

Bezahlt (Abschlag): 150,00 € (paidTotal)
────────────────────────────
Balance:           +2,64 € → Nachzahlung
```

---

### ℹ️ **info** (Informationen)

| Datenpunkt           | Beschreibung                 | Beispiel         |
| -------------------- | ---------------------------- | ---------------- |
| `currentPrice`       | Aktueller Arbeitspreis       | 0,1885 €/kWh     |
| `meterReading`       | Zählerstand in kWh           | 112711,26 kWh    |
| `meterReadingVolume` | Zählerstand in m³ (nur Gas)  | 10305,03 m³      |
| `lastSync`           | Letzte Sensor-Aktualisierung | 06.01.2026 14:11 |
| `sensorActive`       | Sensor verbunden?            | ✅ true          |

---

### 📈 **statistics** (Statistiken)

| Datenpunkt       | Beschreibung                         |
| ---------------- | ------------------------------------ |
| `averageDaily`   | Durchschnittlicher Tagesverbrauch    |
| `averageMonthly` | Durchschnittlicher Monatsverbrauch   |
| `lastDayStart`   | Letzter Tages-Reset (00:00 Uhr)      |
| `lastMonthStart` | Letzter Monats-Reset (1. des Monats) |
| `lastYearStart`  | Vertragsbeginn / Jahresstart         |

---

## ⚙️ Spezialfunktionen

### ⚡ Gas: m³ → kWh Umrechnung

Gasverbrauch wird in **m³ gemessen**, aber in **kWh abgerechnet**.

**Formel:** `kWh = m³ × Brennwert × Z-Zahl`

**Beispiel:**

- Verbrauch: 66,82 m³
- Brennwert: 11,5 kWh/m³ (von Gasrechnung)
- Z-Zahl: 0,95 (von Gasrechnung)
- **Ergebnis:** 66,82 × 11,5 × 0,95 = **730,01 kWh**

💡 **Tipp:** Brennwert und Z-Zahl findest du auf deiner Gasrechnung!

---

### 🔄 Automatische Resets

Der Adapter setzt Zähler automatisch zurück:

| Zeitpunkt             | Was passiert  | Beispiel            |
| --------------------- | ------------- | ------------------- |
| **00:00 Uhr** täglich | `daily` → 0   | Neuer Tag beginnt   |
| **1. des Monats**     | `monthly` → 0 | Neuer Monat beginnt |
| **1. Januar**         | `yearly` → 0  | Neues Jahr beginnt  |

✅ **Keine manuelle Aktion nötig!**

---

### 💳 Abschlagsüberwachung

Trage deinen **monatlichen Abschlag** ein (z.B. 150 €).

Der Adapter zeigt dir dann:

1. **paidTotal** - Wieviel du bisher bezahlt hast
2. **balance** - Ob Nachzahlung oder Guthaben droht

**Beispiel nach 6 Monaten:**

```
Bezahlt:        6 × 150 € = 900 €
Verbraucht:     800 € + 90 € Grundgebühr = 890 €
Balance:        -10 € → 10 € Guthaben! ✅
```

---

## 📝 Beispiel-Konfigurationen

### Gas mit Shelly Plus 1PM

1. Shelly als Impulszähler am Gaszähler montieren
2. Datenpunkt auswählen: `shelly.0.shellypluspm1.Meter0`
3. Brennwert: 11,5 | Z-Zahl: 0,95
4. Arbeitspreis: 0,1835 €/kWh
5. Grundgebühr: 15,03 €/Monat

### Wasser mit Homematic

1. HM-Sen-Wa-Od Sensor installieren
2. Datenpunkt auswählen: `hm-rpc.0.ABC123.METER`
3. Arbeitspreis: 2,08 €/m³
4. Grundgebühr: 15,00 €/Monat

### Strom mit Shelly 3EM

1. Shelly 3EM installiert
2. Datenpunkt: `shelly.0.shelly3em.Total`
3. Arbeitspreis: 0,30 €/kWh
4. Grundgebühr: 12,00 €/Monat

---

## 🔧 Troubleshooting

### ❌ Sensor liefert keine Werte

1. ✅ Sensor-Datenpunkt korrekt?
2. 📋 Log prüfen (Adapter-Instanz → Log)
3. 🔍 `info.sensorActive` = true?

### ❌ Kosten = 0 €

1. ✅ Arbeitspreis eingetragen? (darf nicht 0 sein)
2. ✅ Verbrauch > 0?
3. 🔍 `info.currentPrice` prüfen

### ❌ Gas-Umrechnung stimmt nicht

1. ✅ Brennwert korrekt? (10-12 kWh/m³)
2. ✅ Z-Zahl korrekt? (0,90-1,00)
3. 📋 Werte auf Gasrechnung nachsehen

### ❌ Zählerstand weicht ab

1. ✅ **Offset** eintragen: `Physischer Wert - Sensor Wert`
2. ✅ **Initial Reading** prüfen (Vertragsbeginn)

---

## 📜 Changelog

### 0.0.5 (2026-01-06)

- **FIX:** Täglicher/Monatlicher Reset funktioniert jetzt zuverlässig
- Vereinfachte Reset-Logik (nicht mehr zeitkritisch)

### 0.0.4 (2026-01-05)

- **BREAKING CHANGE:** Preis-Tabellen durch einfache Felder ersetzt
- Nur noch: Arbeitspreis + Grundgebühr (keine Preishistorie mehr)
- Einfachere Konfiguration
- Entfernt: `costs.total` (redundant)

### 0.0.3 (2026-01-05)

- Verbesserte Monate-Berechnung (Year/Month Differenz statt Tage)
- Balance-Vorzeichen gefixt (negativ = Guthaben)

### 0.0.2 (2026-01-05)

- Korrekte Grundgebühren-Akkumulation
- Jahresverbrauch basiert auf Initial Reading
- Gas Volume States (m³) hinzugefügt

### 0.0.1 (2026-01-02)

- Initial release
- Gas, Wasser, Strom Überwachung
- Kostenberechnung
- Automatische Resets

---

## 📄 License

MIT License

Copyright (c) 2026 fischi87 <axel.fischer@hotmail.com>

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
