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
import { SPair } from "@fleet-sdk/serializer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectTokens, output, rsBTC, rsBtcId, sigUSD, sigUsdId } from "./helper";

describe("Timed fund contract", () => {
    const ergoTree = compile(
        `{	
  def getMakerPk(box: Box)               = box.R4[SigmaProp].getOrElse(sigmaProp(false))
  def getPaymentAddress(box: Box)        = box.R5[Coll[Byte]].getOrElse(Coll[Byte]())
	def getSellingTokenId(box: Box)        = box.R6[(Coll[Byte],Coll[Byte])].getOrElse((Coll[Byte](),Coll[Byte]()))._1
	def getBuyingTokenId(box: Box)         = box.R6[(Coll[Byte],Coll[Byte])].getOrElse((Coll[Byte](),Coll[Byte]()))._2
  def getRate(box: Box)                  = box.R7[Coll[Long]].getOrElse(Coll[SigmaProp](0L,0L))(0)
  def getDenom(box: Box)                 = box.R7[Coll[Long]].getOrElse(Coll[SigmaProp](0L,0L))(1)

	def tokenId(box: Box) = box.tokens(0)._1
	def tokenAmount(box: Box) = box.tokens(0)._2

	def isSameContract(box: Box) = 
		box.propositionBytes == SELF.propositionBytes

	def isSameTokenPair (box: Box) = 
		getSellingTokenId(SELF) == getSellingTokenId(box) &&
		getBuyingTokenId(SELF)  == getBuyingTokenId(box)

	
    def hasSellingToken(box: Box) = 
		getSellingTokenId(SELF) == getSellingTokenId(box) &&
		box.tokens.size > 0 &&
		getSellingTokenId(SELF) == tokenId(box)

	def hasBuyingToken(box: Box) = 
		getBuyingTokenId(SELF) == getBuyingTokenId(box) &&
		box.tokens.size > 0 &&
		getBuyingTokenId(SELF) == tokenId(box)

  	def isGreaterZeroRate(box:Box) =
		getRate(box) > 0

	def isSameMaker(box: Box)   = 
		getMakerPk(SELF) == getMakerPk(box) &&
		getPaymentAddress(SELF) == getPaymentAddress(box)

	def isLegitInput(box: Box) =
		isSameContract(box) &&
		isSameMaker(box) &&
		isSameTokenPair(box) &&
		hasSellingToken(box) &&
		isGreaterZeroRate(box)

    val maxDenom: Long = INPUTS
		.filter(isLegitInput)
		.fold(0L, {(r:Long, box:Box) => {
			if(r > getDenom(box)) r else getDenom(box)
		}}) 
  
    def getRateInMaxDenom(box:Box) = getRate(box)*maxDenom/getDenom(box) 

  	def sumTokenAmount(a:Long, b: Box) = a + tokenAmount(b)
  	def sumTokenAmountXRate(a:Long, b: Box) = a + tokenAmount(b) * getRateInMaxDenom(b)  

    val maxSellRate: Long = INPUTS
      .filter(isLegitInput)
      .fold(0L, {(r:Long, box:Box) => {
        if(r > getRateInMaxDenom(box)) r else getRateInMaxDenom(box)
      }})

    def hasMaxSellRate(box: Box) =
        getRate(box) * maxDenom == maxSellRate * getDenom(box) 

  	def isLegitSellOrderOutput(box: Box) =
	  	isLegitInput(box)&&
	  	hasMaxSellRate(box)

	def isPaymentBox(box:Box) =
		isSameMaker(box) &&
		hasBuyingToken(box) &&
		getPaymentAddress(SELF) == box.propositionBytes

	def sumSellTokensIn(boxes: Coll[Box]): Long = boxes
		.filter(isLegitInput) 
		.fold(0L, sumTokenAmount)


	def sumBuyTokensPaid(boxes: Coll[Box]): Long = boxes
		.filter(isPaymentBox) 
		.fold(0L, sumTokenAmount)
  	val tokensPaid = sumBuyTokensPaid(OUTPUTS).toBigInt 

    	val inSellTokensXRate = INPUTS 
		.filter(isLegitInput) 
		.fold(0L, sumTokenAmountXRate)   

     	val outSellTokensXRate = OUTPUTS  
		.filter(isLegitSellOrderOutput)
		.fold(0L, sumTokenAmountXRate)  

    val sellTokensXRate = inSellTokensXRate.toBigInt - outSellTokensXRate.toBigInt  
    val expectedRate = sellTokensXRate.toBigInt 

    val isPaidAtFairRate = maxDenom.toBigInt*tokensPaid.toBigInt >= expectedRate.toBigInt  
 
		getMakerPk(SELF) || sigmaProp(isPaidAtFairRate)
}`
    );
    const mockChain = new MockChain({ height: 1_052_944 });
    const unlockHeight = mockChain.height + 500;
    const maker = mockChain.newParty("Seller");
    const maker2 = mockChain.newParty("Seller2");
    const taker = mockChain.newParty("Bob");
    mockChain.parties;

    const swap = mockChain.addParty(ergoTree.toHex(), "Token Swap Contract");

    const swapBtcUsdRegs = (pk: KeyedMockChainParty, rate: bigint = 1n, denom: bigint = 1n) => ({
        R4: SSigmaProp(SGroupElement(pk.key.publicKey)).toHex(),
        R5: SColl(SByte, pk.ergoTree).toHex(),
        R6: SPair(SColl(SByte, rsBtcId), SColl(SByte, sigUsdId)).toHex(),
        R7: SColl(SLong, [rate, denom]).toHex()
    });

    afterEach(() => {
        mockChain.reset();
    });

    describe("Swap", () => {
        beforeEach(() => {
            mockChain.jumpTo(unlockHeight + 1);
            expect(mockChain.height).to.be.above(unlockHeight);
        });

        it("can be canceled by maker to any address", () => {
            swap.addBalance({ nanoergs: 1_000_000n, tokens: [rsBTC(100)] }, swapBtcUsdRegs(maker));

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === swap.ergoTree))
                .from([...swap.utxos])
                .to([output(maker2, [rsBTC(100)])])
                .build();

            expect(mockChain.execute(transaction, { signers: [maker] })).to.be.true;
            expectTokens(maker2, [rsBTC(100)]);
        });

        it("basic: 100 rsBTC -> 100 SigUSD", () => {
            swap.addBalance({ nanoergs: 1_000_000n, tokens: [rsBTC(100)] }, swapBtcUsdRegs(maker));
            taker.addBalance({ nanoergs: 10_000_000n, tokens: [sigUSD(200)] });

            const transaction = new TransactionBuilder(mockChain.height)
                .configureSelector((s) => s.ensureInclusion((b) => b.ergoTree === swap.ergoTree))
                .from([...swap.utxos, ...taker.utxos])
                .to([
                    output(maker, [sigUSD(100)], swapBtcUsdRegs(maker)),
                    output(taker, rsBTC(100))
                ])
                .sendChangeTo(taker.address)
                .build();

            expect(mockChain.execute(transaction, { signers: [taker] })).to.be.true;
            expectTokens(maker, [sigUSD(100)]);
            expectTokens(taker, [rsBTC(100), sigUSD(100)]);
        });
    });
});
