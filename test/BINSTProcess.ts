import hre from "hardhat";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

describe("BINST Process (Thin L2 Architecture)", function () {
  let connection: Awaited<ReturnType<typeof hre.network.connect>>;
  let publicClient: Awaited<ReturnType<Awaited<ReturnType<typeof hre.network.connect>>["viem"]["getPublicClient"]>>;
  let deployer: Awaited<ReturnType<Awaited<ReturnType<typeof hre.network.connect>>["viem"]["getWalletClients"]>>[0];
  let factory: Awaited<ReturnType<Awaited<ReturnType<typeof hre.network.connect>>["viem"]["deployContract"]>>;

  const TEMPLATE_INSCRIPTION_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2i0";

  before(async function () {
    connection = await hre.network.connect();
    publicClient = await connection.viem.getPublicClient();
    [deployer] = await connection.viem.getWalletClients();
    factory = await connection.viem.deployContract("BINSTProcessFactory");
  });

  // ── Factory ────────────────────────────────────────────────────

  describe("BINSTProcessFactory", function () {
    it("Should create an instance linked to an L1 template inscription", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Submit Document", "Review", "Sign Off"],
        ["submission", "approval", "signature"],
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Instance was registered
      const count = await factory.read.getInstanceCount();
      assert.ok(count >= 1n);

      const instances = await factory.read.getUserInstances([deployer.account.address]);
      assert.ok(instances.length >= 1);

      // InstanceCreated event was emitted
      const logs = receipt.logs;
      assert.ok(logs.length > 0, "Expected InstanceCreated event");
    });

    it("Should index instances by template inscription ID", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Step A"],
        ["approval"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getTemplateInstances([TEMPLATE_INSCRIPTION_ID]);
      assert.ok(instances.length >= 1, "Should find instances for this template");
    });

    it("Should isolate instances from different templates", async function () {
      const otherTemplate = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00i0";

      const txHash = await factory.write.createInstance([
        otherTemplate,
        ["Only Step"],
        ["verification"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const otherInstances = await factory.read.getTemplateInstances([otherTemplate]);
      assert.equal(otherInstances.length, 1, "Other template should have exactly 1 instance");
    });
  });

  // ── BINSTProcess (self-contained instance) ─────────────────────

  describe("BINSTProcess", function () {
    it("Should store template inscription ID and step definitions", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Upload ID", "Verify Identity", "Final Approval"],
        ["upload", "verification", "approval"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instanceAddr = instances[instances.length - 1];
      const instance = await connection.viem.getContractAt("BINSTProcess", instanceAddr);

      // L1 anchor
      assert.equal(await instance.read.templateInscriptionId(), TEMPLATE_INSCRIPTION_ID);

      // Steps are self-contained (no external template contract needed)
      assert.equal(await instance.read.getStepCount(), 3n);

      const [name0, action0] = await instance.read.getStep([0n]);
      assert.equal(name0, "Upload ID");
      assert.equal(action0, "upload");

      const [name2, action2] = await instance.read.getStep([2n]);
      assert.equal(name2, "Final Approval");
      assert.equal(action2, "approval");
    });

    it("Should execute steps sequentially and complete", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["First", "Second"],
        ["approval", "signature"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instanceAddr = instances[instances.length - 1];
      const instance = await connection.viem.getContractAt("BINSTProcess", instanceAddr);

      // Initial state
      assert.equal(await instance.read.isCompleted(), false);
      assert.equal(await instance.read.currentStepIndex(), 0n);
      assert.equal(await instance.read.totalSteps(), 2n);
      assert.equal(
        (await instance.read.creator()).toLowerCase(),
        deployer.account.address.toLowerCase(),
      );

      // Execute step 1 (Completed = 1)
      let execTx = await instance.write.executeStep([1, '{"evidence":"doc1"}']);
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.currentStepIndex(), 1n);
      assert.equal(await instance.read.isCompleted(), false);

      // Execute step 2
      execTx = await instance.write.executeStep([1, '{"evidence":"doc2"}']);
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.currentStepIndex(), 2n);
      assert.equal(await instance.read.isCompleted(), true);
    });

    it("Should not advance on rejected step", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Review", "Approve"],
        ["approval", "signature"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instance = await connection.viem.getContractAt(
        "BINSTProcess",
        instances[instances.length - 1],
      );

      // Reject (status = 2)
      const execTx = await instance.write.executeStep([2, '{"reason":"failed review"}']);
      await publicClient.waitForTransactionReceipt({ hash: execTx });

      assert.equal(await instance.read.currentStepIndex(), 0n, "Should stay on step 0");
      assert.equal(await instance.read.isCompleted(), false);
    });

    it("Should not allow execution after completion", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Only Step"],
        ["approval"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instance = await connection.viem.getContractAt(
        "BINSTProcess",
        instances[instances.length - 1],
      );

      // Complete the single step
      const execTx = await instance.write.executeStep([1, "done"]);
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.isCompleted(), true);

      // Try to execute again — should revert
      await assert.rejects(async () => {
        await instance.write.executeStep([1, "extra"]);
      });
    });

    it("Should accept payment steps", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Pay Fee"],
        ["payment"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instance = await connection.viem.getContractAt(
        "BINSTProcess",
        instances[instances.length - 1],
      );

      const execTx = await instance.write.executeStepWithPayment(
        ['{"receipt":"payment_proof"}'],
        { value: 1000000000000000n }, // 0.001 ETH/cBTC
      );
      await publicClient.waitForTransactionReceipt({ hash: execTx });
      assert.equal(await instance.read.isCompleted(), true);
    });

    it("Should read step state after execution", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Step A", "Step B"],
        ["approval", "signature"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instance = await connection.viem.getContractAt(
        "BINSTProcess",
        instances[instances.length - 1],
      );

      // Execute step A
      const execTx = await instance.write.executeStep([1, '{"signed":"true"}']);
      await publicClient.waitForTransactionReceipt({ hash: execTx });

      // Read step state
      const [status, actor, data, timestamp] = await instance.read.getStepState([0n]);
      assert.equal(status, 1); // Completed
      assert.equal(actor.toLowerCase(), deployer.account.address.toLowerCase());
      assert.equal(data, '{"signed":"true"}');
      assert.ok(timestamp > 0n);

      // Step B should still be pending (default)
      const [statusB, , ,] = await instance.read.getStepState([1n]);
      assert.equal(statusB, 0); // Pending
    });

    it("Should record migration origin fields as zero for native instances", async function () {
      const txHash = await factory.write.createInstance([
        TEMPLATE_INSCRIPTION_ID,
        ["Step"],
        ["approval"],
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const instances = await factory.read.getAllInstances();
      const instance = await connection.viem.getContractAt(
        "BINSTProcess",
        instances[instances.length - 1],
      );

      assert.equal(await instance.read.sourceChainId(), 0);
      assert.equal(
        await instance.read.sourceAddress(),
        "0x0000000000000000000000000000000000000000",
      );
    });
  });
});
