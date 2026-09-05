$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Root=Split-Path -Parent $PSScriptRoot
$Writer=Join-Path $Root 'SCRIPTS/UpsertP2GCWarmPipelineWorkbook.ps1'
$Temp=Join-Path ([IO.Path]::GetTempPath()) ('p2gc-xlsx-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp|Out-Null

$Headers=@(
 'Company','Primary Contact','Email','Phone','Relationship','Evidence Level','Last Known Stage','Last Known Touch',
 'Past Conversation / Need','What They Wanted','Known Price / Terms','Potential Value','Value Basis','Objection / Why Stalled',
 'Federal Position / Vehicles','Agencies / Buyers','Current Trigger / Opportunity','Biggest Gap','Reason to Reopen Now',
 'Recommended P2GC Offer','Next Action','Demo Required?','Best Outreach','Evidence Source','Source Confidence',
 'Commercial Terms / Proposal','Explicit Need','Meeting / Call','Specific Gov Issue','Timing / Trigger','Multiple Interactions',
 'Decision Maker Involved','Prior Paid / Client','Clear No','Unqualified','Score','Priority','Outreach Status','Last Outreach Result',
 'Next Follow-Up','Contact Verified?'
)
function Col([int]$n){$s='';while($n-gt 0){$n--;$s=[char](65+($n%26))+$s;$n=[math]::Floor($n/26)};return $s}
function Esc([string]$v){return [Security.SecurityElement]::Escape($v)}
function InlineCell([string]$ref,[string]$value){return '<c r="'+$ref+'" t="inlineStr"><is><t>'+([Security.SecurityElement]::Escape($value))+'</t></is></c>'}

try{
 $Pkg=Join-Path $Temp 'pkg'; New-Item -ItemType Directory -Path $Pkg,$Pkg/_rels,$Pkg/xl,$Pkg/xl/_rels,$Pkg/xl/worksheets,$Pkg/xl/worksheets/_rels,$Pkg/xl/tables -Force|Out-Null
 $contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'
 Set-Content -LiteralPath (Join-Path $Pkg '[Content_Types].xml') -Value $contentTypes -Encoding UTF8
 Set-Content -LiteralPath (Join-Path $Pkg '_rels/.rels') -Value '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' -Encoding UTF8
 Set-Content -LiteralPath (Join-Path $Pkg 'xl/workbook.xml') -Value '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Warm Prospect Master" sheetId="1" r:id="rId1"/></sheets></workbook>' -Encoding UTF8
 Set-Content -LiteralPath (Join-Path $Pkg 'xl/_rels/workbook.xml.rels') -Value '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' -Encoding UTF8
 $head='';for($i=0;$i-lt $Headers.Count;$i++){$head+=InlineCell "$(Col ($i+1))1" $Headers[$i]}
 $row2=(InlineCell 'A2' 'Existing Prospect LLC')+(InlineCell 'B2' 'Old Contact')+(InlineCell 'C2' 'old@existing.example')
 $sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:AO2"/><sheetData><row r="1">'+$head+'</row><row r="2">'+$row2+'</row></sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>'
 Set-Content -LiteralPath (Join-Path $Pkg 'xl/worksheets/sheet1.xml') -Value $sheet -Encoding UTF8
 Set-Content -LiteralPath (Join-Path $Pkg 'xl/worksheets/_rels/sheet1.xml.rels') -Value '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>' -Encoding UTF8
 $cols='';for($i=0;$i-lt $Headers.Count;$i++){$cols+='<tableColumn id="'+($i+1)+'" name="'+(Esc $Headers[$i])+'"/>'}
 $table='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="WarmProspectMasterTable" displayName="WarmProspectMasterTable" ref="A1:AO2" totalsRowShown="0"><autoFilter ref="A1:AO2"/><tableColumns count="41">'+$cols+'</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>'
 Set-Content -LiteralPath (Join-Path $Pkg 'xl/tables/table1.xml') -Value $table -Encoding UTF8
 $Book=Join-Path $Temp 'master.xlsx'; [IO.Compression.ZipFile]::CreateFromDirectory($Pkg,$Book)

 $row1=[ordered]@{'Company'='Acme Federal LLC';'Primary Contact'='Jane Owner';'Email'='jane@acme.example';'Website / Domain'='https://acme.example';'Lead Source'='LinkedIn';'Source URL'='https://linkedin.com/posts/acme';'Original Post Date'='2026-09-05';'Date Discovered'='2026-09-05T12:00:00Z';'Request / Pain Point'='Needs GSA sales help';'Signal Excerpt'='We have a GSA Schedule but no sales.';'Lead Category'='GSA_HELP';'Lead Temperature'='HOT';'Urgency'='CURRENT';'P2GC Fit'='GSA activation';'Research Completed'='Y';'Outreach Prepared'='Y';'Outreach Sent'='N';'Priority'='HOT-INTENT';'Outreach Status'='Prepared'}
 $Json=Join-Path $Temp 'row.json'; $row1|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $Json -Encoding UTF8
 $result=& $Writer -WorkbookPath $Book -RowJsonPath $Json | Out-String | ConvertFrom-Json
 if(!$result.ok -or $result.status -ne 'WARM_PIPELINE_UPSERT_GREEN' -or $result.action -ne 'APPEND'){throw 'FIRST_UPSERT_NOT_GREEN'}
 if($result.tableRef -ne 'A1:BK3'){throw "UNEXPECTED_TABLE_REF:$($result.tableRef)"}
 if($result.headersAdded.Count -ne 22){throw "INTENT_HEADERS_NOT_ADDED:$($result.headersAdded.Count)"}
 if(!(Test-Path $result.backup)){throw 'BACKUP_NOT_CREATED'}

 $row1.'Request / Pain Point'='Updated GSA sales problem'; $row1.'Outreach Sent'='Y'; $row1.'Outreach Status'='Sent'; $row1|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $Json -Encoding UTF8
 Start-Sleep -Milliseconds 1100
 $result2=& $Writer -WorkbookPath $Book -RowJsonPath $Json | Out-String | ConvertFrom-Json
 if(!$result2.ok -or $result2.action -ne 'UPDATE' -or $result2.matchReason -ne 'EMAIL'){throw 'SECOND_UPSERT_NOT_DEDUPED'}
 if($result2.row -ne 3 -or $result2.tableRef -ne 'A1:BK3'){throw 'UPDATE_CREATED_DUPLICATE_ROW'}

 $Check=Join-Path $Temp 'check'; [IO.Compression.ZipFile]::ExtractToDirectory($Book,$Check)
 [xml]$sx=Get-Content -Raw (Join-Path $Check 'xl/worksheets/sheet1.xml'); $ns=New-Object Xml.XmlNamespaceManager($sx.NameTable);$ns.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
 $rows=@($sx.SelectNodes('//x:sheetData/x:row',$ns)); if($rows.Count -ne 3){throw "ROW_COUNT_WRONG:$($rows.Count)"}
 $sourceCell=$sx.SelectSingleNode('//x:row[@r="3"]/x:c[@r="AT3"]/x:is/x:t',$ns); if(!$sourceCell -or $sourceCell.InnerText -ne 'https://linkedin.com/posts/acme'){throw 'SOURCE_URL_NOT_PERSISTED'}
 $painCell=$sx.SelectSingleNode('//x:row[@r="3"]/x:c[@r="AW3"]/x:is/x:t',$ns); if(!$painCell -or $painCell.InnerText -ne 'Updated GSA sales problem'){throw "PAIN_POINT_UPDATE_NOT_PERSISTED:$($painCell.InnerText)"}
 [xml]$tx=Get-Content -Raw (Join-Path $Check 'xl/tables/table1.xml'); $tn=New-Object Xml.XmlNamespaceManager($tx.NameTable);$tn.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $tc=$tx.SelectSingleNode('//x:tableColumns',$tn); if([int]$tc.count -ne 63){throw "TABLE_COLUMN_COUNT_WRONG:$($tc.count)"}; if($tx.table.ref -ne 'A1:BK3'){throw 'TABLE_REF_NOT_PERSISTED'}
 Write-Output 'P2GC_WARM_PIPELINE_XLSX_UPSERT_GREEN'
} finally { Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue }
