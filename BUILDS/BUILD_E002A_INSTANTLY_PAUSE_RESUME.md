\# BUILD E002A — INSTANTLY CONTROLLED PAUSE AND RESUME



\## PROJECT ROOT



D:\\P2GC\_Intelligence\\MILES\_ENTERPRISE



\---



\## FILES TO MODIFY



SERVICES\\ControlledWritePolicyService.js



SERVICES\\InstantlyControlledWriteService.js



\---



\## FILES TO CREATE



tests\\instantly\_controlled\_pause\_resume.test.js



\---



\# OBJECTIVE



Complete the existing controlled-write implementation for:



\- PAUSE\_TEST\_CAMPAIGN

\- RESUME\_TEST\_CAMPAIGN



Rules:



\- Do NOT create a new service.

\- Do NOT modify InstantlyCOOService.

\- Do NOT enable production operations.

\- Do NOT remove any existing safeguards.



\---



\# 1. FIX CONTROLLED WRITE ROOT



Replace the current fallback root:



D:\\P2GC\_Intelligence\\MILES\_OS



with:



```javascript

const ROOT =

&#x20;   process.env.MILES\_ROOT ||

&#x20;   path.resolve(\_\_dirname, "..");

```



The policy file must resolve to:



```

DATA\\controlled\_write\\controlled\_write\_policy.json

```



inside the MILES Enterprise project.



Preserve any existing policy file.



\---



\# 2. IMPLEMENT PAUSE\_TEST\_CAMPAIGN



Replace the current safeNotImplemented() implementation.



Required payload:



```javascript

{

&#x20;   campaignId,

&#x20;   name

}

```



Validation:



\- campaignId required

\- name required

\- name must begin with:



```

MILES\_TEST\_

```



Before pausing:



1\. Fetch campaign



2\. Verify campaign exists



3\. Verify campaign name begins with:



```

MILES\_TEST\_

```



4\. Verify payload name equals live campaign name



Reject otherwise.



Never allow production campaigns.



Pause endpoint:



```

POST

https://api.instantly.ai/api/v2/campaigns/{campaignId}/pause

```



Authorization:



```

Bearer ${INSTANTLY\_API\_KEY}

```



After pause:



Verify using:



```

GET

https://api.instantly.ai/api/v2/campaigns/{campaignId}

```



Success:



```

campaign.status == 2

```



Return:



```javascript

{

&#x20;   ok,

&#x20;   provider,

&#x20;   operation,

&#x20;   status,

&#x20;   executed,

&#x20;   verified,

&#x20;   campaignId,

&#x20;   campaignName,

&#x20;   expectedCampaignStatus:2,

&#x20;   actualCampaignStatus,

&#x20;   verification,

&#x20;   durationMs,

&#x20;   generatedAt

}

```



Possible status values:



\- VERIFIED

\- EXECUTED\_NOT\_VERIFIED

\- API\_ERROR

\- REQUEST\_FAILED

\- INVALID\_CAMPAIGN\_ID

\- TEST\_CAMPAIGN\_REQUIRED

\- CAMPAIGN\_NAME\_MISMATCH

\- CAMPAIGN\_LOOKUP\_FAILED

\- MISSING\_CREDENTIALS



\---



\# 3. IMPLEMENT RESUME\_TEST\_CAMPAIGN



Replace safeNotImplemented().



Same validation rules.



Endpoint:



```

POST

https://api.instantly.ai/api/v2/campaigns/{campaignId}/activate

```



Verify:



```

GET

/api/v2/campaigns/{campaignId}

```



Expected:



```

campaign.status == 1

```



Return the same object.



expectedCampaignStatus:



```

1

```



\---



\# 4. CREATE REUSABLE HELPERS



Refactor common logic into:



```

getApiKey()



requestJson()



getCampaign()



validateTestCampaign()



changeCampaignState()



verifyCampaignStatus()

```



Avoid duplicate fetch logic.



Every path must audit.



Never throw uncaught exceptions.



\---



\# 5. POLICY



Keep allowlisted:



```

CREATE\_TEST\_CAMPAIGN



PAUSE\_TEST\_CAMPAIGN



RESUME\_TEST\_CAMPAIGN

```



Blocked:



```

DELETE\_CAMPAIGN



BULK\_UPLOAD\_LEADS\_PRODUCTION



START\_PRODUCTION\_CAMPAIGN

```



Preserve:



```

dryRunDefault = true



writesRequireExplicitEnv = true



requireTestPrefix = true



testPrefix = "MILES\_TEST\_"



requireVerification = true



allowDestructive = false

```



Do NOT automatically enable:



```

MILES\_CONTROLLED\_WRITE\_ENABLED



INSTANTLY\_WRITE\_ENABLED

```



\---



\# 6. TESTS



Create:



```

tests/instantly\_controlled\_pause\_resume.test.js

```



Using mocked fetch.



No live API calls.



Tests:



✓ Missing campaignId rejected



✓ Non-test campaign rejected



✓ Live campaign without MILES\_TEST\_ rejected



✓ Payload/live mismatch rejected



✓ Pause endpoint called



✓ Pause verifies status 2



✓ Resume endpoint called



✓ Resume verifies status 1



✓ API failures handled



✓ Audit recorded



✓ Existing CREATE\_TEST\_CAMPAIGN still passes



✓ Policy root resolves correctly



\---



\# 7. VALIDATION



Run:



```

node --check SERVICES/ControlledWritePolicyService.js



node --check SERVICES/InstantlyControlledWriteService.js



node --test tests/instantly\_controlled\_pause\_resume.test.js

```



Then execute all existing controlled-write tests.



\---



\# RETURN



Provide:



\- Files modified

\- Files created

\- Tests passed

\- Tests failed

\- Policy path

\- Blockers

\- Confirmation that no live API requests occurred during testing

