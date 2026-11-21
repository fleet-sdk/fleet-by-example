import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  SByte,
  SColl,
  SGroupElement,
  SLong,
  SSigmaProp,
  TransactionBuilder
} from "@fleet-sdk/core";
import { afterEach, describe, expect, it } from "vitest";

const SALE_TOKEN_ID = "1111111111111111111111111111111111111111111111111111111111111111";
const MIN_BOX_VALUE = 1_000_000n;
const PRICE_PER_TOKEN = 10_000_000n; // 0.01 ERG per token

function hexToBytes(hexString: string): Uint8Array {
  return Uint8Array.from({ length: hexString.length / 2 }, (_, index) =>
    Number.parseInt(hexString.slice(index * 2, index * 2 + 2), 16)
  );
}

const SELF_REPLICATING_TOKEN_SALE_SCRIPT = `{
  val saleCycleValid = if (OUTPUTS.size >= 1) {
    val selfTokenId = SELF.tokens(0)._1
    val selfTokenAmount = SELF.tokens(0)._2

    val remainingTokens = if (
      OUTPUTS.size >= 2 &&
      OUTPUTS(1).propositionBytes == SELF.propositionBytes &&
      OUTPUTS(1).tokens.size == 1 &&
      OUTPUTS(1).tokens(0)._1 == selfTokenId
    ) {
      OUTPUTS(1).tokens(0)._2
    } else {
      0L
    }

    val continuationSafe = remainingTokens == 0L || OUTPUTS(1).value >= SELF.value
    val soldTokens = selfTokenAmount - remainingTokens

    val payoutValid =
      soldTokens > 0L &&
      OUTPUTS(0).propositionBytes == sellerPK.propBytes &&
      OUTPUTS(0).value >= soldTokens * pricePerToken &&
      OUTPUTS(0).R4[Coll[Byte]].getOrElse(Coll[Byte]()) == SELF.id

    continuationSafe && payoutValid
  } else {
    false
  }

  sellerPK || sigmaProp(saleCycleValid)
}`;

describe("Self-replicating token sale contract", () => {
  const mockChain = new MockChain({ height: 1_052_944 });

  const seller = mockChain.newParty("Seller");
  const buyer = mockChain.newParty("Buyer");
  const attacker = mockChain.newParty("Attacker");

  const ergoTree = compile(SELF_REPLICATING_TOKEN_SALE_SCRIPT, {
    map: {
      sellerPK: SSigmaProp(SGroupElement(seller.key.publicKey)),
      pricePerToken: SLong(PRICE_PER_TOKEN)
    }
  });

  const saleContract = mockChain.addParty(ergoTree.toHex(), "Token Sale Contract");

  afterEach(() => {
    mockChain.reset();
  });

  it("Should allow a partial purchase when continuation box preserves remaining supply", () => {
    saleContract.addBalance({
      nanoergs: MIN_BOX_VALUE,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: 100n }]
    });
    buyer.addBalance({ nanoergs: 2_000_000_000n });

    const saleBox = saleContract.utxos.toArray()[0];
    const tokensToBuy = 25n;
    const remainingTokens = 75n;
    const sellerPayout = tokensToBuy * PRICE_PER_TOKEN;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([saleBox, ...buyer.utxos.toArray()])
      .to([
        new OutputBuilder(sellerPayout, seller.address).setAdditionalRegisters({
          R4: SColl(SByte, hexToBytes(saleBox.boxId)).toHex()
        }),
        new OutputBuilder(MIN_BOX_VALUE, saleContract.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: remainingTokens
        }),
        new OutputBuilder(MIN_BOX_VALUE, buyer.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: tokensToBuy
        })
      ])
      .sendChangeTo(buyer.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [buyer] })).to.be.true;

    expect(seller.balance).to.be.deep.equal({ nanoergs: sellerPayout, tokens: [] });
    expect(saleContract.balance).to.be.deep.equal({
      nanoergs: MIN_BOX_VALUE,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: remainingTokens }]
    });
    expect(buyer.balance.tokens).to.be.deep.equal([
      { tokenId: SALE_TOKEN_ID, amount: tokensToBuy }
    ]);
  });

  it("Should allow buying the entire token supply without requiring a continuation box", () => {
    saleContract.addBalance({
      nanoergs: MIN_BOX_VALUE,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: 40n }]
    });
    buyer.addBalance({ nanoergs: 2_000_000_000n });

    const saleBox = saleContract.utxos.toArray()[0];
    const fullPayout = 40n * PRICE_PER_TOKEN;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([saleBox, ...buyer.utxos.toArray()])
      .to([
        new OutputBuilder(fullPayout, seller.address).setAdditionalRegisters({
          R4: SColl(SByte, hexToBytes(saleBox.boxId)).toHex()
        }),
        new OutputBuilder(MIN_BOX_VALUE, buyer.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: 40n
        })
      ])
      .sendChangeTo(buyer.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [buyer] })).to.be.true;

    expect(saleContract.balance).to.be.deep.equal({ nanoergs: 0n, tokens: [] });
    expect(seller.balance).to.be.deep.equal({ nanoergs: fullPayout, tokens: [] });
    expect(buyer.balance.tokens).to.be.deep.equal([{ tokenId: SALE_TOKEN_ID, amount: 40n }]);
  });

  it("Should reject an underpaid token purchase", () => {
    saleContract.addBalance({
      nanoergs: MIN_BOX_VALUE,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: 100n }]
    });
    attacker.addBalance({ nanoergs: 2_000_000_000n });

    const saleBox = saleContract.utxos.toArray()[0];
    const underpaidAmount = 25n * PRICE_PER_TOKEN - 1n;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([saleBox, ...attacker.utxos.toArray()])
      .to([
        new OutputBuilder(underpaidAmount, seller.address).setAdditionalRegisters({
          R4: SColl(SByte, hexToBytes(saleBox.boxId)).toHex()
        }),
        new OutputBuilder(MIN_BOX_VALUE, saleContract.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: 75n
        }),
        new OutputBuilder(MIN_BOX_VALUE, attacker.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: 25n
        })
      ])
      .sendChangeTo(attacker.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [attacker], throw: false })).to.be.false;
  });

  it("Should reject a double-satisfaction attack across two concurrent sale boxes", () => {
    saleContract.addBalance({
      nanoergs: MIN_BOX_VALUE,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: 10n }]
    });
    saleContract.addBalance({
      nanoergs: MIN_BOX_VALUE,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: 10n }]
    });
    attacker.addBalance({ nanoergs: 2_000_000_000n });

    const [firstSaleBox, secondSaleBox] = saleContract.utxos.toArray();
    const singleBoxPayout = 10n * PRICE_PER_TOKEN;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([firstSaleBox, secondSaleBox, ...attacker.utxos.toArray()])
      .to([
        new OutputBuilder(singleBoxPayout, seller.address).setAdditionalRegisters({
          R4: SColl(SByte, hexToBytes(firstSaleBox.boxId)).toHex()
        }),
        new OutputBuilder(MIN_BOX_VALUE, attacker.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: 20n
        })
      ])
      .sendChangeTo(attacker.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [attacker], throw: false })).to.be.false;
  });

  it("Should allow the seller to cancel the sale and withdraw unsold tokens", () => {
    saleContract.addBalance({
      nanoergs: 5_000_000n,
      tokens: [{ tokenId: SALE_TOKEN_ID, amount: 100n }]
    });

    const transaction = new TransactionBuilder(mockChain.height)
      .from(saleContract.utxos)
      .to(
        new OutputBuilder(3_900_000n, seller.address).addTokens({
          tokenId: SALE_TOKEN_ID,
          amount: 100n
        })
      )
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [seller] })).to.be.true;
    expect(saleContract.balance).to.be.deep.equal({ nanoergs: 0n, tokens: [] });
    expect(seller.balance.tokens).to.be.deep.equal([{ tokenId: SALE_TOKEN_ID, amount: 100n }]);
  });
});
