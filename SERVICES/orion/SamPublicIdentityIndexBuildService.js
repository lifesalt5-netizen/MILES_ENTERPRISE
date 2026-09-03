'use strict';

const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const readline=require('readline');
const {parseRecord}=require('./SamQualifiedUniverseBuildService');

function now(){return new Date().toISOString();}
function sourceDateFromName(name){return (String(name).match(/(20\d{6})/)||[])[1]||null;}
function canonicalCompact(value){return String(value||'').toUpperCase().replace(/\b(LLC|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED)\b/g,' ').replace(/[^A-Z0-9]+/g,'').trim();}
function findEocd(fd,size){const len=Math.min(size,65557),buf=Buffer.alloc(len);fs.readSync(fd,buf,0,len,size-len);for(let i=len-22;i>=0;i--)if(buf.readUInt32LE(i)===0x06054b50)return{buf,offset:size-len+i};throw new Error('ZIP_EOCD_NOT_FOUND');}
function zipEntries(zipPath){const fd=fs.openSync(zipPath,'r');try{const size=fs.fstatSync(fd).size,{buf,offset}=findEocd(fd,size),local=offset-(size-buf.length),total=buf.readUInt16LE(local+10),centralSize=buf.readUInt32LE(local+12),centralOffset=buf.readUInt32LE(local+16);if(total===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff)throw new Error('ZIP64_NOT_SUPPORTED');const cd=Buffer.alloc(centralSize);fs.readSync(fd,cd,0,centralSize,centralOffset);const out=[];let p=0;for(let n=0;n<total&&p+46<=cd.length;n++){if(cd.readUInt32LE(p)!==0x02014b50)throw new Error(`ZIP_CENTRAL_SIGNATURE_INVALID:${p}`);const method=cd.readUInt16LE(p+10),compressedSize=cd.readUInt32LE(p+20),uncompressedSize=cd.readUInt32LE(p+24),nameLen=cd.readUInt16LE(p+28),extraLen=cd.readUInt16LE(p+30),commentLen=cd.readUInt16LE(p+32),localHeaderOffset=cd.readUInt32LE(p+42),fileName=cd.subarray(p+46,p+46+nameLen).toString('utf8');out.push({fileName,method,compressedSize,uncompressedSize,localHeaderOffset});p+=46+nameLen+extraLen+commentLen;}return out;}finally{fs.closeSync(fd);}}
function entryStream(zipPath,entry){const fd=fs.openSync(zipPath,'r'),h=Buffer.alloc(30);try{fs.readSync(fd,h,0,30,entry.localHeaderOffset);}finally{fs.closeSync(fd);}if(h.readUInt32LE(0)!==0x04034b50)throw new Error('ZIP_LOCAL_HEADER_INVALID');const start=entry.localHeaderOffset+30+h.readUInt16LE(26)+h.readUInt16LE(28),end=start+entry.compressedSize-1,raw=fs.createReadStream(zipPath,{start,end});if(entry.method===0)return raw;if(entry.method===8){const inflate=zlib.createInflateRaw();raw.pipe(inflate);return inflate;}throw new Error(`ZIP_COMPRESSION_METHOD_UNSUPPORTED:${entry.method}`);}

class SamPublicIdentityIndexBuildService{
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||process.cwd());
    this.stageDir=path.join(this.rootDir,'DATA','orion_refresh','sam_bulk_staging');
    this.outDir=path.join(this.rootDir,'DATA','orion_refresh','sam_identity_staging');
    this.reportPath=path.join(this.rootDir,'DATA','orion_refresh','latest_sam_public_identity_index_build.json');
    this.batchSize=Math.max(1000,Number(options.batchSize||10000));
  }

  latestSource(){
    const names=fs.existsSync(this.stageDir)?fs.readdirSync(this.stageDir):[];
    const sourceName=names.filter(x=>/^SAM_PUBLIC_UTF-8_MONTHLY_V2_\d{8}\.ZIP$/i.test(x)).sort().reverse()[0];
    if(!sourceName)throw new Error('SAM_ENTITY_BULK_SOURCE_MISSING');
    const sourcePath=path.join(this.stageDir,sourceName);
    const entry=zipEntries(sourcePath).filter(e=>e.uncompressedSize>0&&!/\/$/.test(e.fileName)).sort((a,b)=>b.uncompressedSize-a.uncompressedSize)[0];
    if(!entry)throw new Error('SAM_ENTITY_DATA_ENTRY_MISSING');
    return {sourceName,sourcePath,sourceDate:sourceDateFromName(sourceName),entry};
  }

  async run(){
    fs.mkdirSync(this.outDir,{recursive:true});
    const {sourceName,sourcePath,sourceDate,entry}=this.latestSource();
    const Database=require('better-sqlite3');
    const final=path.join(this.outDir,`SAM_PUBLIC_IDENTITY_${sourceDate||'unknown'}.db`);
    const partial=`${final}.partial`;
    try{fs.unlinkSync(partial);}catch{}
    let db=null;
    try{
      db=new Database(partial);
      db.pragma('journal_mode = DELETE');
      db.pragma('synchronous = NORMAL');
      db.exec(`
        CREATE TABLE sam_public_identity(
          uei TEXT PRIMARY KEY,
          cage TEXT,
          legal_name TEXT NOT NULL,
          name_key TEXT NOT NULL,
          dba TEXT,
          dba_key TEXT,
          registration_status TEXT,
          registration_expiration_date TEXT,
          last_update_date TEXT,
          activation_date TEXT,
          website TEXT,
          entity_structure TEXT,
          business_type_codes TEXT,
          primary_naics TEXT,
          naics_codes TEXT,
          sba_business_type_codes TEXT,
          city TEXT,
          state TEXT,
          zip TEXT,
          country TEXT,
          source_file TEXT NOT NULL,
          source_date TEXT,
          loaded_at TEXT NOT NULL
        );
        CREATE INDEX idx_sam_public_identity_cage ON sam_public_identity(cage);
        CREATE INDEX idx_sam_public_identity_name_key ON sam_public_identity(name_key);
        CREATE INDEX idx_sam_public_identity_dba_key ON sam_public_identity(dba_key);
        CREATE INDEX idx_sam_public_identity_status ON sam_public_identity(registration_status);
      `);
      const insert=db.prepare(`INSERT OR REPLACE INTO sam_public_identity(uei,cage,legal_name,name_key,dba,dba_key,registration_status,registration_expiration_date,last_update_date,activation_date,website,entity_structure,business_type_codes,primary_naics,naics_codes,sba_business_type_codes,city,state,zip,country,source_file,source_date,loaded_at) VALUES(@uei,@cage,@legalName,@nameKey,@dba,@dbaKey,@registrationStatus,@expiration,@updated,@activation,@website,@entityStructure,@businessTypes,@primaryNaics,@naics,@sba,@city,@state,@zip,@country,@sourceFile,@sourceDate,@loadedAt)`);
      const tx=db.transaction(rows=>{for(const row of rows)insert.run(row);});
      const loadedAt=now();
      let rawRecords=0,dataRecords=0,malformed=0,storedCandidates=0,batch=[];
      const rl=readline.createInterface({input:entryStream(sourcePath,entry),crlfDelay:Infinity});
      for await(const line of rl){
        if(!line||/^BOF PUBLIC/i.test(line)||/^EOF PUBLIC/i.test(line))continue;
        rawRecords++;
        const f=line.split('|');
        if(f.length<118){malformed++;continue;}
        dataRecords++;
        const c=parseRecord(f);
        if(!c.uei||!c.legalBusinessName){malformed++;continue;}
        storedCandidates++;
        batch.push({
          uei:c.uei,cage:c.cage||null,legalName:c.legalBusinessName,nameKey:canonicalCompact(c.legalBusinessName),dba:c.dbaName||null,dbaKey:canonicalCompact(c.dbaName),registrationStatus:c.registrationStatus||null,expiration:c.registrationExpirationDate||null,updated:c.lastUpdateDate||null,activation:c.activationDate||null,website:c.website||null,entityStructure:c.entityStructure||null,businessTypes:(c.businessTypeCodes||[]).join('~'),primaryNaics:c.primaryNaics||null,naics:(c.naicsCodes||[]).join('~'),sba:(c.sbaBusinessTypeCodes||[]).join('~'),city:c.city||null,state:c.state||null,zip:c.zip||null,country:c.country||null,sourceFile:sourceName,sourceDate,loadedAt
        });
        if(batch.length>=this.batchSize){tx(batch);batch=[];}
      }
      if(batch.length)tx(batch);
      const stored=Number(db.prepare('SELECT COUNT(*) n FROM sam_public_identity').get().n);
      const active=Number(db.prepare("SELECT COUNT(*) n FROM sam_public_identity WHERE registration_status='A'").get().n);
      const integrity=db.pragma('integrity_check',{simple:true});
      db.close();db=null;
      if(integrity!=='ok'||stored<=0)throw new Error(`SAM_PUBLIC_IDENTITY_INDEX_VALIDATION_FAILED:${integrity}:${stored}`);
      try{fs.unlinkSync(final);}catch{}
      fs.renameSync(partial,final);
      const result={ok:true,service:'SAM_PUBLIC_IDENTITY_INDEX_BUILD',generatedAt:now(),source:{file:sourcePath,fileName:sourceName,date:sourceDate,entry:entry.fileName,bytes:fs.statSync(sourcePath).size},output:{database:final,bytes:fs.statSync(final).size,sqliteIntegrity:integrity,storedEntities:stored,activeEntities:active},waterfall:{rawRecords,dataRecords,malformed,storedCandidates,uniqueStored:stored},safety:{publicSamBulkOnly:true,stagingOnly:true,productionDatabaseModified:false,credentialsRead:false,qualifiedLeadUniverseModified:false}};
      fs.writeFileSync(this.reportPath,JSON.stringify(result,null,2),'utf8');
      console.log(JSON.stringify(result,null,2));
      return result;
    }catch(error){try{db?.close();}catch{}try{fs.unlinkSync(partial);}catch{}throw error;}
  }
}

module.exports=SamPublicIdentityIndexBuildService;
module.exports.canonicalCompact=canonicalCompact;
