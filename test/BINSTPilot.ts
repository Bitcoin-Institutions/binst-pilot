import hre from "hardhat";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

describe("BINST Pilot", function () {
  let connection: Awaited<ReturnType<typeof hre.network.connect>>;
  let publicClient: Awaited<ReturnType<Awaited<ReturnType<typeof hre.network.connect>>["viem"]["getPublicClient"]>>;
  let deployer: Awaited<ReturnType<Awaited<ReturnType<typeof hre.network.connect>>["viem"]["getWalletClients"]>>[0];

  before(async function () {
    connection = await hre.network.connect();
    publicClient = await connection.viem.getPublicClient();
    [deployer] = await connection.viem.getWalletClients();
  });

  // ── Institution Layer ──────────────────────────────────────────

  describe("Institution", function () {
    it("Should create an institution via BINSTDeployer", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Acme Corp"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const count = await binstDeployer.read.getInstitutionCount();
      assert.equal(count, 1n);

      const institutions = await binstDeployer.read.getInstitutions();
      assert.equal(institutions.length, 1);

      // Read institution data
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);
      assert.equal(await inst.read.name(), "Acme Corp");
      assert.equal((await inst.read.admin()).toLowerCase(), deployer.account.address.toLowerCase());
      assert.equal(await inst.read.getMemberCount(), 1n); // admin auto-enrolled
    });

    it("Should manage members", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Member Test Org"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const institutions = await binstDeployer.read.getInstitutions();
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);

      // Add a member (use a deterministic address)
      const memberAddr = "0x0000000000000000000000000000000000000042";
      let tx = await inst.write.addMember([memberAddr]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      assert.equal(await inst.read.getMemberCount(), 2n);
      assert.equal(await inst.read.isMember([memberAddr]), true);

      // Remove the member
      tx = await inst.write.removeMember([memberAddr]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      assert.equal(await inst.read.getMemberCount(), 1n);
      assert.equal(await inst.read.isMember([memberAddr]), false);
    });

    it("Should create processes through the institution", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Process Org"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const institutions = await binstDeployer.read.getInstitutions();
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);

      // Create a process through the institution
      const procTx = await inst.write.createProcess([
        "KYC Process",
        "Know Your Customer verification",
        ["ID Upload", "Verification", "Approval"],
        ["Upload ID document", "Verify identity", "Final approval"],
        ["upload", "verification", "approval"],
        ['{"required":true}', '{"method":"auto"}', "{}"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: procTx });

      assert.equal(await inst.read.getProcessCount(), 1n);

      const processes = await inst.read.getProcesses();
      const template = await connection.viem.getContractAt("ProcessTemplate", processes[0]);
      assert.equal(await template.read.name(), "KYC Process");
      assert.equal(await template.read.getStepCount(), 3n);
    });
  });

  // ── Standalone Process (backward compatible) ───────────────────

  describe("BINSTDeployer (standalone)", function () {
    it("Should deploy and register a standalone process template", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.deployProcess([
        "Test Process",
        "A test process template",
        ["Step 1", "Step 2"],
        ["First step", "Second step"],
        ["approval", "signature"],
        ['{"key":"value1"}', '{"key":"value2"}'],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const count = await binstDeployer.read.getDeployedProcessCount();
      assert.equal(count, 1n);

      const processes = await binstDeployer.read.getDeployedProcesses();
      assert.equal(processes.length, 1);
    });
  });

  // ── Process Execution ──────────────────────────────────────────

  describe("ProcessTemplate", function () {
    it("Should create instances and track them", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.deployProcess([
        "Instance Test",
        "Testing instance creation",
        ["Step A", "Step B", "Step C"],
        ["Desc A", "Desc B", "Desc C"],
        ["approval", "verification", "signature"],
        ["{}", "{}", "{}"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const processes = await binstDeployer.read.getDeployedProcesses();
      const template = await connection.viem.getContractAt("ProcessTemplate", processes[0]);

      // Verify step count
      const stepCount = await template.read.getStepCount();
      assert.equal(stepCount, 3n);

      // Create an instance
      const instTxHash = await template.write.instantiate();
      await publicClient.waitForTransactionReceipt({ hash: instTxHash });

      const instances = await template.read.getUserInstances([deployer.account.address]);
      assert.equal(instances.length, 1);

      // Verify instantiation count
      const instCount = await template.read.instantiationCount();
      assert.equal(instCount, 1n);
    });
  });

  describe("ProcessInstance", function () {
    it("Should execute steps sequentially and complete", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      // Deploy a 2-step template
      const txHash = await binstDeployer.write.deployProcess([
        "Two Step",
        "Simple two-step process",
        ["First", "Second"],
        ["First step", "Second step"],
        ["approval", "signature"],
        ["{}", "{}"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const processes = await binstDeployer.read.getDeployedProcesses();
      const template = await connection.viem.getContractAt("ProcessTemplate", processes[0]);

      // Create instance
      const instTxHash = await template.write.instantiate();
      await publicClient.waitForTransactionReceipt({ hash: instTxHash });

      const instances = await template.read.getUserInstances([deployer.account.address]);
      const instance = await connection.viem.getContractAt("ProcessInstance", instances[0]);

      // Verify initial state
      assert.equal(await instance.read.isCompleted(), false);
      assert.equal(await instance.read.currentStepIndex(), 0n);
      assert.equal(await instance.read.totalSteps(), 2n);

      // Execute step 1
      let execTx = await instance.write.executeStep([1, '{"data":"step1"}']); // 1 = Completed
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.currentStepIndex(), 1n);
      assert.equal(await instance.read.isCompleted(), false);

      // Execute step 2
      execTx = await instance.write.executeStep([1, '{"data":"step2"}']);
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.currentStepIndex(), 2n);
      assert.equal(await instance.read.isCompleted(), true);
    });

    it("Should not advance on rejected step", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.deployProcess([
        "Rejection Test",
        "Test rejection handling",
        ["Review", "Approve"],
        ["Review step", "Approval step"],
        ["approval", "signature"],
        ["{}", "{}"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const processes = await binstDeployer.read.getDeployedProcesses();
      const template = await connection.viem.getContractAt("ProcessTemplate", processes[0]);

      const instTxHash = await template.write.instantiate();
      await publicClient.waitForTransactionReceipt({ hash: instTxHash });

      const instances = await template.read.getUserInstances([deployer.account.address]);
      const instance = await connection.viem.getContractAt("ProcessInstance", instances[0]);

      // Reject step 1 — should NOT advance currentStepIndex
      const execTx = await instance.write.executeStep([2, '{"reason":"failed review"}']); // 2 = Rejected
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.currentStepIndex(), 0n); // Still on step 0
      assert.equal(await instance.read.isCompleted(), false);
    });

    it("Should accept payment steps", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.deployProcess([
        "Payment Test",
        "Test payment handling",
        ["Pay Fee"],
        ["Payment step"],
        ["payment"],
        ['{"amount":"0.001"}'],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const processes = await binstDeployer.read.getDeployedProcesses();
      const template = await connection.viem.getContractAt("ProcessTemplate", processes[0]);

      const instTxHash = await template.write.instantiate();
      await publicClient.waitForTransactionReceipt({ hash: instTxHash });

      const instances = await template.read.getUserInstances([deployer.account.address]);
      const instance = await connection.viem.getContractAt("ProcessInstance", instances[0]);

      // Execute with payment
      const execTx = await instance.write.executeStepWithPayment(
        ['{"receipt":"payment_proof"}'],
        { value: 1000000000000000n }, // 0.001 ETH/cBTC
      );
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.isCompleted(), true);
    });
  });

  // ── Bitcoin Identity ───────────────────────────────────────────

  describe("Bitcoin Identity", function () {
    it("Should set and read inscription ID", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Inscription Test"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const institutions = await binstDeployer.read.getInstitutions();
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);

      // Initially empty
      assert.equal(await inst.read.inscriptionId(), "");

      // Set inscription ID
      const testInscriptionId = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2i0";
      const setTx = await inst.write.setInscriptionId([testInscriptionId]);
      await publicClient.waitForTransactionReceipt({ hash: setTx });

      assert.equal(await inst.read.inscriptionId(), testInscriptionId);
    });

    it("Should set and read rune ID", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Rune Test"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const institutions = await binstDeployer.read.getInstitutions();
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);

      // Initially empty
      assert.equal(await inst.read.runeId(), "");

      // Set rune ID
      const testRuneId = "840000:20";
      const setTx = await inst.write.setRuneId([testRuneId]);
      await publicClient.waitForTransactionReceipt({ hash: setTx });

      assert.equal(await inst.read.runeId(), testRuneId);
    });

    it("Should not allow setting inscription ID twice", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Immutable Test"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const institutions = await binstDeployer.read.getInstitutions();
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);

      // Set once — should succeed
      const setTx = await inst.write.setInscriptionId(["abc123i0"]);
      await publicClient.waitForTransactionReceipt({ hash: setTx });

      // Set again — should revert
      await assert.rejects(
        async () => {
          await inst.write.setInscriptionId(["def456i0"]);
        },
      );
    });

    it("Should not allow non-admin to set inscription ID", async function () {
      const binstDeployer = await connection.viem.deployContract("BINSTDeployer");

      const txHash = await binstDeployer.write.createInstitution(["Admin Only Test"]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const institutions = await binstDeployer.read.getInstitutions();
      const inst = await connection.viem.getContractAt("Institution", institutions[0]);

      // Try setting from a non-admin address
      const wallets = await connection.viem.getWalletClients();
      if (wallets.length > 1) {
        const nonAdmin = wallets[1];
        await assert.rejects(
          async () => {
            await inst.write.setInscriptionId(["abc123i0"], {
              account: nonAdmin.account,
            });
          },
        );
      }
    });
  });
});
