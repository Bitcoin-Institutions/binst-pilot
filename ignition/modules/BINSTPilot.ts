import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * BINST Pilot — Ignition Deployment Module
 *
 * Deploys the protocol entry-point:
 * 1. BINSTDeployer — factory/registry for institutions and process templates
 *
 * Institutions and their processes are created post-deployment via
 * BINSTDeployer.createInstitution() and Institution.createProcess().
 *
 * Bitcoin awareness (Light Client reads, finality tracking) is handled
 * off-chain via direct eth_call to Citrea system contracts + Citrea RPCs.
 */
const BINSTPilotModule = buildModule("BINSTPilot", (m) => {
  const deployer = m.contract("BINSTDeployer");

  return { deployer };
});

export default BINSTPilotModule;
