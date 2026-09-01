'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }

class ClientAuthorizedPortalAccessPolicyService {
  evaluate(context = {}) {
    const activePayingClient = context.activePayingClient === true;
    const dedicatedClientWorkspace = context.dedicatedClientWorkspace === true;
    const authorizedAccess = context.authorizedAccess === true;
    const accessEvidenceId = clean(context.accessEvidenceId);
    const withinGrantedScope = context.withinGrantedScope !== false;
    const prospectDemo = context.prospectDemo === true;

    if (prospectDemo) {
      return {
        allowed:false,
        status:'PROSPECT_DEMO_RESTRICTED_ACCESS_PROHIBITED',
        reason:'RESTRICTED_PORTAL_ACCESS_IS_PAYING_CLIENT_ONLY'
      };
    }

    if (!activePayingClient) {
      return { allowed:false, status:'ACTIVE_PAYING_CLIENT_REQUIRED', reason:'ACTIVE_PAYING_CLIENT_REQUIRED' };
    }
    if (!dedicatedClientWorkspace) {
      return { allowed:false, status:'DEDICATED_CLIENT_WORKSPACE_REQUIRED', reason:'DEDICATED_CLIENT_WORKSPACE_REQUIRED' };
    }
    if (!authorizedAccess) {
      return { allowed:false, status:'AUTHORIZED_ACCESS_REQUIRED', reason:'AUTHORIZED_ACCESS_REQUIRED' };
    }
    if (!accessEvidenceId) {
      return { allowed:false, status:'ACCESS_EVIDENCE_REQUIRED', reason:'ACCESS_EVIDENCE_REQUIRED' };
    }
    if (!withinGrantedScope) {
      return { allowed:false, status:'OUTSIDE_GRANTED_SCOPE', reason:'OUTSIDE_GRANTED_SCOPE' };
    }

    return {
      allowed:true,
      status:'AUTHORIZED_CLIENT_PORTAL_ACCESS_ALLOWED',
      accessEvidenceId,
      readOnlyDefault:context.readWriteScope !== 'WRITE',
      requiresSeparateWriteGovernance:context.readWriteScope === 'WRITE'
    };
  }

  prospectDemo() {
    return this.evaluate({ prospectDemo:true });
  }
}

module.exports = new ClientAuthorizedPortalAccessPolicyService();
module.exports.ClientAuthorizedPortalAccessPolicyService = ClientAuthorizedPortalAccessPolicyService;
