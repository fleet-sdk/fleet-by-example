import { compile } from "@fleet-sdk/compiler";
import {
    SByte,
    SColl,
    SGroupElement,
    SLong,
    SSigmaProp,
    TransactionBuilder
} from "@fleet-sdk/core";
import { KeyedMockChainParty, MockChain } from "@fleet-sdk/mock-chain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ergOutput, rsBTC, rsBtcId } from "./helper";

describe("Timed fund contract", () => {
    const ergoTree = compile(`{
      def getMakerPk(box: Box)               = box.R4[SigmaProp].getOrElse(sigmaProp(false))
      def getPaymentAddress(box: Box)        = box.R5[Coll[Byte]].getOrElse(Coll[Byte]())
      def getTokenId(box: Box)               = box.R6[Coll[Byte]].getOrElse(Coll[Byte]()) 
	  def getRate(box: Box)                  = box.R7[Coll[Long]].getOrElse(Coll[SigmaProp](0L,0L))(0)
	  def getDenom(box: Box)                 = box.R7[Coll[Long]].getOrElse(Coll[SigmaProp](0L,0L))(1)

    def tokenAmount(box: Box) = {
        if(box.tokens.size > 0) 
        {
            box.tokens(0)._2
        } else{
         0L
        } 
    }
  
    def isSameContract(box: Box) = 
        box.propositionBytes == SELF.propositionBytes
  
    def isGreaterZeroRate(box:Box) =
        getRate(box) > 0 &&
        getDenom(box) > 0
  
    def isSameMaker(box: Box)   = 
        getMakerPk(SELF) == getMakerPk(box) &&
        getPaymentAddress(SELF) == getPaymentAddress(box)    

    def isLegitInput(b: Box) = {
        isSameContract(b) &&
        isSameMaker(b) && 
        getTokenId(SELF) == getTokenId(b) &&
        isGreaterZeroRate(b)
    }

    def isPaymentBox(box:Box) = {
      isSameMaker(box) &&
      getTokenId(SELF) == getTokenId(box) &&
      getPaymentAddress(SELF) == box.propositionBytes
    }

    val maxDenom: Long = INPUTS
        .filter(isLegitInput)
        .fold(0L, {(r:Long, box:Box) => {
            if(r > getDenom(box)) r else getDenom(box)
        }}) 
  
    def getRateInMaxDenom(box:Box) = getRate(box)*maxDenom/getDenom(box) 

    val filteredInputs = INPUTS.filter(isLegitInput)
    val minBuyRate: Long = filteredInputs
      .fold(getRateInMaxDenom(filteredInputs(0)), {(r:Long, box:Box) => {
        if(r < getRateInMaxDenom(box)) r else getRateInMaxDenom(box)
      }})

    def hasMinBuyRate(box: Box) =
        getRate(box) * maxDenom == getDenom(box) * minBuyRate

    def isChangeBox(box: Box) =
        isLegitInput(box) &&
        hasMinBuyRate(box)

    def sumTokenAmount(a:Long, b: Box) = a + tokenAmount(b)
    def sumErgXMinRate(a:Long, b: Box) = a + b.value * minBuyRate
    def sumErgXRate(a:Long, b: Box) = a + b.value * getRateInMaxDenom(b) 
  	def sumTokenAmountXRate(a:Long, b: Box) = a + tokenAmount(b) * getRateInMaxDenom(b) 

    val tokensPaid = OUTPUTS.filter(isPaymentBox).fold(0L, sumTokenAmount).toBigInt
    val expectedErgXRate = {
        val in = INPUTS.filter(isLegitInput).fold(0L, sumErgXRate)
        val out = OUTPUTS.filter(isChangeBox).fold(0L, sumErgXMinRate).toBigInt +
        OUTPUTS.filter(isPaymentBox).fold(0L, sumErgXMinRate).toBigInt
        
        in - out
    }

    val isPaidAtFairRate = tokensPaid * maxDenom >= expectedErgXRate

    getMakerPk(SELF) || sigmaProp(isPaidAtFairRate)
}`);
    const mockChain = new MockChain({ height: 1_052_944 });
    const buyer = mockChain.newParty("Seller");
    const executor = mockChain.newParty("Bob");
    mockChain.parties;

    const wtb = mockChain.addParty(ergoTree.toHex(), "Token Buy Contract");

    const buyBtcUsdRegs = (pk: KeyedMockChainParty, rate: bigint = 1n, denom: bigint = 1n) => ({
        R4: SSigmaProp(SGroupElement(pk.key.publicKey)).toHex(),
        R5: SColl(SByte, pk.ergoTree).toHex(),
        R6: SColl(SByte, rsBtcId).toHex(),
        R7: SColl(SLong, [rate, denom]).toHex()
    });

    afterEach(() => {
        mockChain.reset();
    });

    describe("Buy", () => {
        beforeEach(() => {
            executor.addBalance({ nanoergs: 100_000n, tokens: [rsBTC(1000)] });
        });
        it("wtb 100 rsBTC with 100 nanoErg", () => {
            wtb.addBalance({ nanoergs: 1_000n + 100n }, buyBtcUsdRegs(buyer, 1n, 1n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 1_000n, [rsBTC(100)], buyBtcUsdRegs(buyer))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor] })).to.be.true;
        });

        it("can't underpay nanoErg", () => {
            wtb.addBalance({ nanoergs: 1_000n + 100n }, buyBtcUsdRegs(buyer, 1n, 1n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 1_000n - 1n, [rsBTC(100)], buyBtcUsdRegs(buyer))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor], throw: false })).to.be
                .false;
        });

        it("can't underpay tokens", () => {
            wtb.addBalance({ nanoergs: 1_000n + 100n }, buyBtcUsdRegs(buyer, 1n, 1n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 1_000n, [rsBTC(100 - 1)], buyBtcUsdRegs(buyer))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor], throw: false })).to.be
                .false;
        });

        it("wtb [100BTC, 100E], [100BTC, 200E]", () => {
            wtb.addBalance({ nanoergs: 100n }, buyBtcUsdRegs(buyer, 1n, 1n));
            wtb.addBalance({ nanoergs: 200n }, buyBtcUsdRegs(buyer, 2n, 1n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 1n, [rsBTC(500)], buyBtcUsdRegs(buyer))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor] })).to.be.true;
        });

        it("change can be sent to buyer address", () => {
            wtb.addBalance({ nanoergs: 2_000n }, buyBtcUsdRegs(buyer, 1n, 10n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 2_000n - 10n, [rsBTC(1)], buyBtcUsdRegs(buyer))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor] })).to.be.true;
        });
        it("change can be sent to contract change box", () => {
            wtb.addBalance({ nanoergs: 1_000n + 1_000n }, buyBtcUsdRegs(buyer, 1n, 10n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 10n, [rsBTC(1)], buyBtcUsdRegs(buyer))])
                .to([ergOutput(wtb, 2_000n - 20n, [], buyBtcUsdRegs(buyer, 1n, 10n))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor] })).to.be.true;
        });
        it("can't manipulate rate in contract change box", () => {
            wtb.addBalance({ nanoergs: 1_000n + 1_000n }, buyBtcUsdRegs(buyer, 1n, 10n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 10n, [rsBTC(1)], buyBtcUsdRegs(buyer))])
                .to([ergOutput(wtb, 2_000n - 20n, [], buyBtcUsdRegs(buyer, 1n, 100n))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor], throw: false })).to.be
                .false;
        });

        it(`wtb 
            20ERG/BTC for 1000ERG  (50BTC max), 
            1ERG/BTC for  100ERG (100BTC max)`, () => {
            // rate = token/ERG
            wtb.addBalance({ nanoergs: 1000n }, buyBtcUsdRegs(buyer, 1n, 20n));
            wtb.addBalance({ nanoergs: 100n }, buyBtcUsdRegs(buyer, 1n, 1n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([ergOutput(buyer, 1n, [rsBTC(150)], buyBtcUsdRegs(buyer))])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor] })).to.be.true;
        });

        it(`can't steal value with change erg
            20ERG/BTC for 1000ERG  (50BTC max), 
            1ERG/BTC for  100ERG (100BTC max)`, () => {
            const stealNanoErg = 1n;
            wtb.addBalance({ nanoergs: 1000n }, buyBtcUsdRegs(buyer, 1n, 20n));
            wtb.addBalance({ nanoergs: 100n }, buyBtcUsdRegs(buyer, 1n, 1n));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === wtb.ergoTree))
                .from([...wtb.utxos, ...executor.utxos])
                .to([
                    ergOutput(
                        buyer,
                        1000n + 20n - stealNanoErg,
                        [rsBTC(100 - 1)],
                        buyBtcUsdRegs(buyer)
                    )
                ])
                .sendChangeTo(executor.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [executor], throw: false })).to.be
                .false;
        });
    });
});
