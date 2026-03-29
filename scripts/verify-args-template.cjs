// Constructor arguments for ProcessTemplate at 0x3A6A07C5D2C420331f68DD407AaFff92f3275a86
module.exports = [
  "KYC Verification",
  "Standard institutional KYC verification process for onboarding",
  ["Document Submission", "Identity Verification", "Compliance Review", "Approval"],
  [
    "Client submits identity documents and proof of address",
    "Automated identity verification against government databases",
    "Compliance officer reviews results and flags any issues",
    "Final approval or rejection by authorized signatory",
  ],
  ["submission", "verification", "approval", "signature"],
  [
    '{"required_docs":["passport","proof_of_address","source_of_funds"]}',
    '{"provider":"automated","confidence_threshold":0.95}',
    '{"role":"compliance_officer","timeout_hours":48}',
    '{"role":"authorized_signatory","multi_sig":false}',
  ],
];
