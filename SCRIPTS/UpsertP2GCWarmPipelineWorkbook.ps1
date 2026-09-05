param(
  [Parameter(Mandatory=$true)][string]$WorkbookPath,
  [Parameter(Mandatory=$true)][string]$RowJsonPath,
  [string]$SheetName = 'Warm Prospect Master',
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$IntentHeaders = @(
 'Website / Domain','Contact Title','Profile / LinkedIn','Lead Source','Source URL','Original Post Date','Date Discovered',
 'Request / Pain Point','Signal Excerpt','Lead Category','Lead Temperature','Urgency','P2GC Fit','Research Completed',
 'Research Evidence URLs','Outreach Prepared','Outreach Sent','Follow-Up Date','Response','Closed / Won / Lost','Revenue','Notes'
)
$ExistingHeaders = @(
 'Company','Primary Contact','Email','Phone','Relationship','Evidence Level','Last Known Stage','Last Known Touch',
 'Past Conversation / Need','What They Wanted','Known Price / Terms','Potential Value','Value Basis','Objection / Why Stalled',
 'Federal Position / Vehicles','Agencies / Buyers','Current Trigger / Opportunity','Biggest Gap','Reason to Reopen Now',
 'Recommended P2GC Offer','Next Action','Demo Required?','Best Outreach','Evidence Source','Source Confidence',
 'Commercial Terms / Proposal','Explicit Need','Meeting / Call','Specific Gov Issue','Timing / Trigger','Multiple Interactions',
 'Decision Maker Involved','Prior Paid / Client','Clear No','Unqualified','Score','Priority','Outreach Status','Last Outreach Result',
 'Next Follow-Up','Contact Verified?'
)

function ColLetters([int]$n){ $s=''; while($n -gt 0){ $n--; $s=[char](65+($n%26))+$s; $n=[math]::Floor($n/26) }; return $s }
function ColNumber([string]$ref){ $m=[regex]::Match($ref,'^[A-Z]+'); $n=0; foreach($c in $m.Value.ToCharArray()){ $n=$n*26+([int][char]$c-64) }; return $n }
function Norm([object]$v){ if($null -eq $v){return ''}; return ([string]$v).Trim() }
function NormCompany([object]$v){ return ((Norm $v).ToUpperInvariant() -replace '&',' AND ' -replace '[^A-Z0-9]+',' ' -replace '\s+',' ').Trim() }
function NormDomain([object]$v){
 $raw=(Norm $v).ToLowerInvariant(); if(!$raw){return ''}
 try { if($raw -notmatch '^https?://'){ $raw='https://'+$raw }; $u=[Uri]$raw; return ($u.Host -replace '^www\.','').ToLowerInvariant() }
 catch { return (($raw -replace '^https?://','' -replace '^www\.','') -split '[/?#]')[0] }
}
function LoadXml([string]$file){ $x=New-Object System.Xml.XmlDocument; $x.PreserveWhitespace=$true; $x.Load($file); return $x }
function Ns([xml]$x){ $n=New-Object System.Xml.XmlNamespaceManager($x.NameTable); $n.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $n.AddNamespace('r','http://schemas.openxmlformats.org/officeDocument/2006/relationships'); $n.AddNamespace('p','http://schemas.openxmlformats.org/package/2006/relationships'); return $n }
function SharedStrings([string]$root){
 $file=Join-Path $root 'xl/sharedStrings.xml'; if(!(Test-Path $file)){return @()}; $x=LoadXml $file; $n=Ns $x; $out=@(); foreach($si in $x.SelectNodes('//x:si',$n)){ $texts=@($si.SelectNodes('.//x:t',$n)|ForEach-Object{$_.InnerText}); $out+=($texts -join '') }; return ,$out
}
function CellText($cell,$shared,$ns){
 if($null -eq $cell){return ''}; $t=$cell.GetAttribute('t');
 if($t -eq 'inlineStr'){ $node=$cell.SelectSingleNode('./x:is/x:t',$ns); return $(if($node){$node.InnerText}else{''}) }
 $v=$cell.SelectSingleNode('./x:v',$ns); if(!$v){return ''}; if($t -eq 's'){ $i=0; if([int]::TryParse($v.InnerText,[ref]$i) -and $i -lt $shared.Count){return [string]$shared[$i]} }; return $v.InnerText
}
function SetCellText($cell,[string]$text,$doc,$ns){
 $cell.SetAttribute('t','inlineStr'); foreach($child in @($cell.ChildNodes)){ if($child.LocalName -in @('v','is')){ [void]$cell.RemoveChild($child) } }
 $is=$doc.CreateElement('is','http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $t=$doc.CreateElement('t','http://schemas.openxmlformats.org/spreadsheetml/2006/main');
 if($text -match '^\s|\s$'){ $space=$doc.CreateAttribute('xml','space','http://www.w3.org/XML/1998/namespace'); $space.Value='preserve'; [void]$t.Attributes.Append($space) }
 $t.InnerText=$text; [void]$is.AppendChild($t); [void]$cell.AppendChild($is)
}
function CellByCol($row,[int]$col){ foreach($c in @($row.ChildNodes)){ if($c.LocalName -eq 'c' -and (ColNumber $c.GetAttribute('r')) -eq $col){return $c} }; return $null }
function EnsureCell($row,[int]$col,[int]$rowNum,$doc){
 $existing=CellByCol $row $col; if($existing){return $existing}; $c=$doc.CreateElement('c','http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $c.SetAttribute('r',"$(ColLetters $col)$rowNum");
 $inserted=$false; foreach($node in @($row.ChildNodes)){ if($node.LocalName -eq 'c' -and (ColNumber $node.GetAttribute('r')) -gt $col){ [void]$row.InsertBefore($c,$node); $inserted=$true; break } }; if(!$inserted){[void]$row.AppendChild($c)}; return $c
}

if(!(Test-Path $WorkbookPath)){throw "WORKBOOK_NOT_FOUND:$WorkbookPath"}
if(!(Test-Path $RowJsonPath)){throw "ROW_JSON_NOT_FOUND:$RowJsonPath"}
$rowData=Get-Content -Raw -LiteralPath $RowJsonPath | ConvertFrom-Json
$sourceUrl=Norm $rowData.'Source URL'; if(!$sourceUrl){throw 'SOURCE_URL_REQUIRED'}
$requestPain=Norm $rowData.'Request / Pain Point'; if(!$requestPain){throw 'REQUEST_PAIN_POINT_REQUIRED'}
$leadTemp=(Norm $rowData.'Lead Temperature').ToUpperInvariant(); if($leadTemp -notin @('HOT','WARM','WATCH')){throw 'LEAD_TEMPERATURE_INVALID'}

$tempRoot=Join-Path ([IO.Path]::GetTempPath()) ("p2gc-warm-pipeline-"+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $tempRoot|Out-Null
$extract=Join-Path $tempRoot 'xlsx'; New-Item -ItemType Directory -Path $extract|Out-Null
try{
 [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $WorkbookPath),$extract)
 $wb=LoadXml (Join-Path $extract 'xl/workbook.xml'); $wbn=Ns $wb; $sheet=$wb.SelectSingleNode("//x:sheet[@name='$SheetName']",$wbn); if(!$sheet){throw "SHEET_NOT_FOUND:$SheetName"}
 $rid=$sheet.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships'); $rels=LoadXml (Join-Path $extract 'xl/_rels/workbook.xml.rels'); $rn=Ns $rels; $rel=$rels.SelectSingleNode("//p:Relationship[@Id='$rid']",$rn); if(!$rel){throw 'WORKBOOK_RELATIONSHIP_NOT_FOUND'}
 $sheetRel=($rel.GetAttribute('Target') -replace '/','\'); if($sheetRel -notmatch '^worksheets\\'){ $sheetRel='worksheets\'+[IO.Path]::GetFileName($sheetRel) }
 $sheetFile=Join-Path (Join-Path $extract 'xl') $sheetRel; $ws=LoadXml $sheetFile; $wsn=Ns $ws; $sheetData=$ws.SelectSingleNode('//x:sheetData',$wsn); if(!$sheetData){throw 'SHEET_DATA_NOT_FOUND'}
 $shared=SharedStrings $extract; $headerRow=$sheetData.SelectSingleNode('./x:row[@r="1"]',$wsn); if(!$headerRow){throw 'HEADER_ROW_NOT_FOUND'}
 $headers=@{}; foreach($c in @($headerRow.ChildNodes)){ if($c.LocalName -ne 'c'){continue}; $headers[(CellText $c $shared $wsn)]=ColNumber $c.GetAttribute('r') }
 $missingExisting=@($ExistingHeaders|Where-Object{!$headers.ContainsKey($_)}); if($missingExisting.Count){throw ('EXISTING_SCHEMA_MISMATCH:'+($missingExisting -join '|'))}
 $allHeaders=@($ExistingHeaders+$IntentHeaders); $nextCol=([int](($headers.Values|Measure-Object -Maximum).Maximum))+1
 foreach($h in $IntentHeaders){ if(!$headers.ContainsKey($h)){ $cell=EnsureCell $headerRow $nextCol 1 $ws; SetCellText $cell $h $ws $wsn; $headers[$h]=$nextCol; $nextCol++ } }
 $maxCol=[int](($headers.Values|Measure-Object -Maximum).Maximum)

 # Find current table from worksheet relationship.
 $sheetRelsPath=Join-Path ([IO.Path]::GetDirectoryName($sheetFile)) ('_rels\'+[IO.Path]::GetFileName($sheetFile)+'.rels'); if(!(Test-Path $sheetRelsPath)){throw 'SHEET_RELATIONSHIPS_NOT_FOUND'}
 $srels=LoadXml $sheetRelsPath; $srn=Ns $srels; $tablePart=$ws.SelectSingleNode('//x:tablePart',$wsn); if(!$tablePart){throw 'WARM_PIPELINE_TABLE_NOT_FOUND'}; $trid=$tablePart.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships'); $trel=$srels.SelectSingleNode("//p:Relationship[@Id='$trid']",$srn); if(!$trel){throw 'TABLE_RELATIONSHIP_NOT_FOUND'}
 $target=$trel.GetAttribute('Target'); $tableFile=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($sheetFile)) ($target -replace '/','\'))); $table=LoadXml $tableFile; $tn=Ns $table; $tableRoot=$table.DocumentElement; $tableCols=$table.SelectSingleNode('//x:tableColumns',$tn); if(!$tableCols){throw 'TABLE_COLUMNS_NOT_FOUND'}
 $existingTableNames=@($tableCols.SelectNodes('./x:tableColumn',$tn)|ForEach-Object{$_.GetAttribute('name')}); foreach($h in $IntentHeaders){ if($existingTableNames -notcontains $h){ $node=$table.CreateElement('tableColumn','http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $node.SetAttribute('id',[string]($tableCols.ChildNodes.Count+1)); $node.SetAttribute('name',$h); [void]$tableCols.AppendChild($node) } }; $tableCols.SetAttribute('count',[string]$tableCols.ChildNodes.Count)

 $rows=@($sheetData.SelectNodes('./x:row',$wsn)|Where-Object{$_.GetAttribute('r') -ne '1'}); $best=$null
 function RowVal($r,[string]$h){ if(!$headers.ContainsKey($h)){return ''}; return CellText (CellByCol $r ([int]$headers[$h])) $shared $wsn }
 $inEmail=(Norm $rowData.Email).ToLowerInvariant(); $inDomain=NormDomain $rowData.'Website / Domain'; if(!$inDomain -and $inEmail -match '@'){ $inDomain=($inEmail -split '@')[1] }; $inCompany=NormCompany $rowData.Company; $inContact=(Norm $rowData.'Primary Contact').ToLowerInvariant()
 foreach($r in $rows){
  $score=0;$reason=''; $e=(RowVal $r 'Email').ToLowerInvariant(); $d=NormDomain (RowVal $r 'Website / Domain'); if(!$d -and $e -match '@'){$d=($e -split '@')[1]}; $co=NormCompany (RowVal $r 'Company'); $ct=(RowVal $r 'Primary Contact').ToLowerInvariant()
  if($inEmail -and $e -and $inEmail -eq $e){$score=100;$reason='EMAIL'} elseif($inDomain -and $d -and $inDomain -eq $d){$score=90;$reason='DOMAIN'} elseif($inCompany -and $co -and $inCompany -eq $co){$score=80;$reason='COMPANY'} elseif($inContact -and $ct -and $inCompany -and $co -and $inContact -eq $ct -and $inCompany -eq $co){$score=70;$reason='CONTACT+COMPANY'}
  if($score -and (!$best -or $score -gt $best.Score)){ $best=[pscustomobject]@{Row=$r;Score=$score;Reason=$reason} }
 }
 $action='APPEND'; if($best){$targetRow=$best.Row;$rowNum=[int]$targetRow.GetAttribute('r');$action='UPDATE';$matchReason=$best.Reason}else{ $rowNum=([int](($sheetData.SelectNodes('./x:row',$wsn)|ForEach-Object{[int]$_.GetAttribute('r')}|Measure-Object -Maximum).Maximum))+1; $targetRow=$ws.CreateElement('row','http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $targetRow.SetAttribute('r',[string]$rowNum); [void]$sheetData.AppendChild($targetRow); $matchReason=$null }
 foreach($h in $allHeaders){ if(!$headers.ContainsKey($h)){continue}; $p=$rowData.PSObject.Properties[$h]; if($null -eq $p){continue}; $value=Norm $p.Value; if(!$value){continue}; $cell=EnsureCell $targetRow ([int]$headers[$h]) $rowNum $ws; SetCellText $cell $value $ws $wsn }

 $maxRow=[int](($sheetData.SelectNodes('./x:row',$wsn)|ForEach-Object{[int]$_.GetAttribute('r')}|Measure-Object -Maximum).Maximum); $newRef="A1:$(ColLetters $maxCol)$maxRow"; $tableRoot.SetAttribute('ref',$newRef); $af=$table.SelectSingleNode('//x:autoFilter',$tn); if($af){$af.SetAttribute('ref',$newRef)}; $dim=$ws.SelectSingleNode('//x:dimension',$wsn); if($dim){$dim.SetAttribute('ref',$newRef)}
 $plan=[ordered]@{ok=$true;status='WARM_PIPELINE_UPSERT_PLANNED';action=$action;matchReason=$matchReason;row=$rowNum;tableRef=$newRef;headersAdded=@($IntentHeaders|Where-Object{$existingTableNames -notcontains $_});workbook=$WorkbookPath;sheet=$SheetName;sourceUrl=$sourceUrl;leadTemperature=$leadTemp;mutationPerformed=$false}
 if($PlanOnly){ $plan|ConvertTo-Json -Depth 6; return }
 $ws.Save($sheetFile); $table.Save($tableFile)
 $out=Join-Path $tempRoot 'updated.xlsx'; [IO.Compression.ZipFile]::CreateFromDirectory($extract,$out,[IO.Compression.CompressionLevel]::Optimal,$false)
 $stamp=Get-Date -Format 'yyyyMMdd_HHmmss'; $backup="$WorkbookPath.before_intent_upsert_$stamp.bak"; Copy-Item -LiteralPath $WorkbookPath -Destination $backup -Force; Copy-Item -LiteralPath $out -Destination $WorkbookPath -Force
 $plan.status='WARM_PIPELINE_UPSERT_GREEN'; $plan.mutationPerformed=$true; $plan.backup=$backup; $plan|ConvertTo-Json -Depth 6
} finally { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
