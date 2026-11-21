import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp,
  TransactionBuilder
} from "@fleet-sdk/core";
import { afterEach, describe, expect, it } from "vitest";

const ESCROW_DEPOSIT = 5_000_000_000n; // 5 ERG
const MAX_MINER_FEE = 1_100_000n; // 0.0011 ERG
const DIVERTED_AMOUNT = 1_000_000n; // 0.001 ERG

const ESCROW_DEPOSIT_SCRIPT = `{
  val cooperativeRelease = buyerPK && sellerPK

  val sellerAward =
    arbiterPK &&
    sellerPK &&
    sigmaProp(
      OUTPUTS.size >= 1 &&
      OUTPUTS(0).propositionBytes == sellerPK.propBytes &&
      OUTPUTS(0).value >= SELF.value - maxMinerFee
    )

  val buyerAward =
    arbiterPK &&
    buyerPK &&
    sigmaProp(
      OUTPUTS.size >= 1 &&
      OUTPUTS(0).propositionBytes == buyerPK.propBytes &&
      OUTPUTS(0).value >= SELF.value - maxMinerFee
    )

  val timeoutRefund =
    buyerPK &&
    sigmaProp(
      HEIGHT > refundDeadline &&
      OUTPUTS.size >= 1 &&
      OUTPUTS(0).propositionBytes == buyerPK.propBytes &&
      OUTPUTS(0).value >= SELF.value - maxMinerFee
    )

  cooperativeRelease || sellerAward || buyerAward || timeoutRefund
}`;

describe("Arbiter escrow deposit contract", () => {
  const mockChain = new MockChain({ height: 1_052_944 });
  const refundDeadline = mockChain.height + 720;

  const buyer = mockChain.newParty("Buyer");
  const seller = mockChain.newParty("Seller");
  const arbiter = mockChain.newParty("Arbiter");

  const ergoTree = compile(ESCROW_DEPOSIT_SCRIPT, {
    map: {
      buyerPK: SSigmaProp(SGroupElement(buyer.key.publicKey)),
      sellerPK: SSigmaProp(SGroupElement(seller.key.publicKey)),
      arbiterPK: SSigmaProp(SGroupElement(arbiter.key.publicKey)),
      refundDeadline: SInt(refundDeadline),
      maxMinerFee: SLong(MAX_MINER_FEE)
    }
  });

  const escrowContract = mockChain.addParty(ergoTree.toHex(), "Escrow Deposit Contract");

  afterEach(() => {
    mockChain.reset();
  });

  it("Should allow cooperative release co-signed by Buyer and Seller", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const transaction = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, seller.address))
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [buyer, seller] })).to.be.true;
    expect(seller.balance).to.be.deep.equal({ nanoergs: payout, tokens: [] });
  });

  it("Should allow Arbiter and Seller to resolve a dispute in favor of Seller", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const transaction = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, seller.address))
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [arbiter, seller] })).to.be.true;
    expect(seller.balance).to.be.deep.equal({ nanoergs: payout, tokens: [] });
  });

  it("Should reject an Arbiter and Seller spend that diverts funds to Arbiter", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const transaction = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, arbiter.address))
      .payMinFee()
      .build();

    expect(
      mockChain.execute(transaction, { signers: [arbiter, seller], throw: false })
    ).to.be.false;
    expect(escrowContract.balance).to.be.deep.equal({ nanoergs: ESCROW_DEPOSIT, tokens: [] });
  });

  it("Should allow Arbiter and Buyer to resolve a dispute in favor of Buyer", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const transaction = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, buyer.address))
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [arbiter, buyer] })).to.be.true;
    expect(buyer.balance).to.be.deep.equal({ nanoergs: payout, tokens: [] });
  });

  it("Should reject an Arbiter and Buyer spend that diverts funds or underpays Buyer", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const wrongRecipientTx = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, arbiter.address))
      .payMinFee()
      .build();

    expect(
      mockChain.execute(wrongRecipientTx, { signers: [arbiter, buyer], throw: false })
    ).to.be.false;

    const underpaidBuyerTx = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to([
        new OutputBuilder(payout - DIVERTED_AMOUNT, buyer.address),
        new OutputBuilder(DIVERTED_AMOUNT, arbiter.address)
      ])
      .payMinFee()
      .build();

    expect(
      mockChain.execute(underpaidBuyerTx, { signers: [arbiter, buyer], throw: false })
    ).to.be.false;
    expect(escrowContract.balance).to.be.deep.equal({ nanoergs: ESCROW_DEPOSIT, tokens: [] });
  });

  it("Should reject a unilateral refund by Buyer before the deadline", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const transaction = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, buyer.address))
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [buyer], throw: false })).to.be.false;
    expect(escrowContract.balance).to.be.deep.equal({ nanoergs: ESCROW_DEPOSIT, tokens: [] });
  });

  it("Should allow Buyer to reclaim funds to Buyer address within fee cap after deadline", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });
    mockChain.jumpTo(refundDeadline + 1);

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const transaction = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, buyer.address))
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [buyer] })).to.be.true;
    expect(buyer.balance).to.be.deep.equal({ nanoergs: payout, tokens: [] });
  });

  it("Should reject a post-deadline Buyer spend directed to another party", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });
    mockChain.jumpTo(refundDeadline + 1);

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const thirdPartyTx = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to(new OutputBuilder(payout, seller.address))
      .payMinFee()
      .build();

    expect(mockChain.execute(thirdPartyTx, { signers: [buyer], throw: false })).to.be.false;
    expect(escrowContract.balance).to.be.deep.equal({ nanoergs: ESCROW_DEPOSIT, tokens: [] });
  });

  it("Should reject a post-deadline Buyer refund that deducts more than maxMinerFee", () => {
    escrowContract.addBalance({ nanoergs: ESCROW_DEPOSIT });
    mockChain.jumpTo(refundDeadline + 1);

    const payout = ESCROW_DEPOSIT - MAX_MINER_FEE;
    const excessiveDeductionTx = new TransactionBuilder(mockChain.height)
      .from(escrowContract.utxos)
      .to([
        new OutputBuilder(payout - DIVERTED_AMOUNT, buyer.address),
        new OutputBuilder(DIVERTED_AMOUNT, arbiter.address)
      ])
      .payMinFee()
      .build();

    expect(
      mockChain.execute(excessiveDeductionTx, { signers: [buyer], throw: false })
    ).to.be.false;
    expect(escrowContract.balance).to.be.deep.equal({ nanoergs: ESCROW_DEPOSIT, tokens: [] });
  });
});
