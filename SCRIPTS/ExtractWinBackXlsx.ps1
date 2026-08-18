param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [int]$MaxRows = 5000,
    [int]$MaxSheets = 10
)

$ErrorActionPreference = 'Stop'

function Read-ZipEntryText {
    param($Zip, [string]$EntryName)
    $entry = $Zip.GetEntry($EntryName)
    if (-not $entry) { return $null }
    $stream = $entry.Open()
    try {
        $reader = New-Object System.IO.StreamReader($stream)
        try { return $reader.ReadToEnd() }
        finally { $reader.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Column-Index {
    param([string]$CellRef)
    $letters = ($CellRef -replace '[^A-Za-z]', '').ToUpperInvariant()
    $value = 0
    foreach ($ch in $letters.ToCharArray()) {
        $value = ($value * 26) + ([int][char]$ch - [int][char]'A' + 1)
    }
    return [Math]::Max(0, $value - 1)
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "FILE_NOT_FOUND:$Path"
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
try {
    $sharedStrings = New-Object System.Collections.Generic.List[string]
    $sharedText = Read-ZipEntryText -Zip $zip -EntryName 'xl/sharedStrings.xml'
    if ($sharedText) {
        [xml]$sharedXml = $sharedText
        foreach ($si in $sharedXml.SelectNodes("//*[local-name()='si']")) {
            $parts = @($si.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText })
            $sharedStrings.Add(($parts -join ''))
        }
    }

    $output = New-Object System.Collections.Generic.List[object]
    $sheets = @($zip.Entries | Where-Object { $_.FullName -match '^xl/worksheets/sheet\d+\.xml$' } | Sort-Object FullName | Select-Object -First $MaxSheets)

    foreach ($sheetEntry in $sheets) {
        $sheetText = Read-ZipEntryText -Zip $zip -EntryName $sheetEntry.FullName
        if (-not $sheetText) { continue }
        [xml]$sheetXml = $sheetText
        $rows = New-Object System.Collections.Generic.List[object]
        $rowNodes = @($sheetXml.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']") | Select-Object -First $MaxRows)

        foreach ($rowNode in $rowNodes) {
            $cells = @{}
            $maxIndex = -1
            foreach ($cell in $rowNode.SelectNodes("./*[local-name()='c']")) {
                $index = Column-Index -CellRef ([string]$cell.r)
                if ($index -gt $maxIndex) { $maxIndex = $index }
                $type = [string]$cell.t
                $valueNode = $cell.SelectSingleNode("./*[local-name()='v']")
                $value = if ($valueNode) { [string]$valueNode.InnerText } else { '' }

                if ($type -eq 's' -and $value -match '^\d+$') {
                    $sharedIndex = [int]$value
                    if ($sharedIndex -ge 0 -and $sharedIndex -lt $sharedStrings.Count) {
                        $value = $sharedStrings[$sharedIndex]
                    }
                }
                elseif ($type -eq 'inlineStr') {
                    $parts = @($cell.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText })
                    $value = $parts -join ''
                }

                $cells[$index] = $value
            }

            if ($maxIndex -lt 0) { continue }
            $values = New-Object object[] ($maxIndex + 1)
            for ($i = 0; $i -le $maxIndex; $i++) {
                $values[$i] = if ($cells.ContainsKey($i)) { [string]$cells[$i] } else { '' }
            }
            $rows.Add($values)
        }

        $output.Add([pscustomobject]@{
            sheet = $sheetEntry.FullName
            rows = $rows
        })
    }

    $output | ConvertTo-Json -Depth 8 -Compress
}
finally {
    $zip.Dispose()
}
