'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toUpperCase(); }

const ACTIVE_CLIENT_STATUSES = new Set(['ACTIVE','PAID','ACTIVE_PAID_CLIENT','CLIENT_ACTIVE']);

class ClientAuthorizedPortalAccessPolicyService {
  evaluate(context = {}) {
    const clientStatus = norm(context.clientStatus || context.billingStatus || context.relationshipStatus);
    const isPayingClient = context.isPayingClient === true || ACTIVE_CLIENT_STATUSES.has(clientStatus);
    const workspaceId = clean(context.clientWorkspaceId || context.workspaceId);
    const clientId = clean(context.clientId || context.accountId);
    const prospectMode = context.prospectMode === true || norm(context.environment) === 'PROSPECT_DEMO';
    const authorizationEvidenceId = clean(context.authorizationEvidenceId || context.accessEvidenceId);
    const vaultReference = clean(context.vaultReference || context.secretReference || context.sessionReference);
    const withinGrantedScope = context.withinGrantedScope !== false;
    const termsPermit = context.portalTermsPermit !== false;
    const mfaBypassed = context.mfaBypassed === true;
    const credentialInPlaintext = context.credentialInPlaintext === true;

    if (!isPayingClient) {
      return {
        allowed:false,
        status:'PAYING_CLIENT_REQUIRED',
        reason:'AUTHORIZED_PORTAL_CONNECTIONS_ARE_AVAILABLE_ONLY_TO_ACTIVE_PAYING_CLIENTS'
      };
    }
    if (prospectMode) {
      return {
        allowed:false,
        status:'PROSPECT_DEMO_PORTAL_ACCESS_PROHIBITED',
        reason:'PROSPECT_DEMO_MAY_DESCRIBE_AUTHORIZED_COVERAGE_BUT_MUST_NOT_ACCEPT_OR_USE_RESTRICTED_PORTAL_CREDENTIALS'
      };
    }
    if (!clientId || !workspaceId) {
      return {
        allowed:false,
        status:'CLIENT_DEDICATED_WORKSPACE_REQUIRED',
        reason:'RESTRICTED_PORTAL_ACCESS_MUST_BE_BOUND_TO_ONE_PAYING_CLIENT_AND_ONE_CLIENT_SCOPED_WORKSPACE'
      };
    }
    if (!authorizationEvidenceId) {
      return {
        allowed:false,
        status:'CLIENT_AUTHORIZATION_EVIDENCE_REQUIRED',
        reason:'CLIENT_AUTHORIZATION_MUST_BE_RECORDED_BEFORE_RESTRICTED_PORTAL_ACCESS'
      };
    }
    if (!termsPermit || !withinGrantedScope) {
      return {
        allowed:false,
        status:'PORTAL_SCOPE_OR_TERMS_BLOCK',
        reason:!termsPermit ? 'PORTAL_TERMS_DO_NOT_PERMIT_REQUESTED_ACCESS_MODE' : 'REQUEST_OUTSIDE_CLIENT_GRANTED_SCOPE'
      };
    }
    if (mfaBypassed) {
      return {
        allowed:false,
        status:'MFA_BYPASS_PROHIBITED',
        reason:'MILES_MUST_PRESERVE_PORTAL_MFA_AND_MAY_NOT_BYPASS_IDENTITY_CONTROLS'
      };
    }
    if (credentialInPlaintext) {
      return {
        allowed:false,
        status:'PLAINTEXT_CREDENTIAL_PROHIBITED',
        reason:'CREDENTIALS_MUST_NOT_BE_STORED_IN_CHAT_SOURCE_CODE_GITHUB_LOGS_CRM_NOTES_OR_PLAINTEXT_FILES'
      };
    }
    if (!vaultReference) {
      return {
        allowed:false,
        status:'SECURE_VAULT_REFERENCE_REQUIRED',
        reason:'AUTHORIZED_SESSION_OR_CREDENTIAL_MATERIAL_MUST_BE_STORED_ONLY_IN_AN_APPROVED_CLIENT_SCOPED_SECRET_VAULT'
      };
    }

    return {
      allowed:true,
      status:'AUTHORIZED_PAYING_CLIENT_PORTAL_ACCESS',
      clientId,
      clientWorkspaceId:workspaceId,
      authorizationEvidenceId,
      vaultReference,
      controls:{
        payingClientOnly:true,
        clientScopedWorkspaceOnly:true,
        leastPrivilege:true,
        readOnlyDefault:true,
        mfaPreserved:true,
        noCredentialSharingByDefault:true,
        noAccessControlBypass:true,
        auditTrailRequired:true,
        revokeAtEngagementEnd:true,
        healthCheckRequired:true
      }
    };
  }
}

module.exports = new ClientAuthorizedPortalAccessPolicyService();
module.exports.ClientAuthorizedPortalAccessPolicyService = ClientAuthorizedPortalAccessPolicyService;
