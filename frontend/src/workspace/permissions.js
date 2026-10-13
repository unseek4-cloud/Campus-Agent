// Visibility hints only; backend authorization remains authoritative.
export const permissions = {
  "admin": {
    "policyUpload": true,
    "policyDelete": true,
    "policyRebuild": true,
    "affairEdit": true,
    "auditExport": true,
    "settingsEdit": true,
    "userManage": true,
    "qaUse": true,
    "searchUse": true,
    "affairView": true,
    "auditView": true,
    "settingsView": true
  },
  "student": {
    "policyUpload": false,
    "policyDelete": false,
    "policyRebuild": false,
    "affairEdit": false,
    "auditExport": false,
    "settingsEdit": false,
    "userManage": false,
    "qaUse": true,
    "searchUse": true,
    "affairView": true,
    "auditView": true,
    "settingsView": true
  }
};
