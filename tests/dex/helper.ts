import { Amount, NonMandatoryRegisters, OneOrMore, TokenAmount } from "@fleet-sdk/common";
import { OutputBuilder } from "@fleet-sdk/core";
import { KeyedMockChainParty, NonKeyedMockChainParty } from "@fleet-sdk/mock-chain";
import { expect } from "vitest";

// these are fake token ids!!!
export const TOKENS = {
    rsBTC: {
        tokenId: "5bf691fbf0c4b17f8f8cece83fa947f62f480bfbd242bd58946f85535125db4d",
        name: "rsBTC",
        decimals: 9,
        type: "EIP-004"
    },
    sigUSD: {
        tokenId: "f60bff91f7ae3f3a5f0c2d35b46ef8991f213a61d7f7e453d344fa52a42d9f9a",
        name: "sigUSD",
        decimals: 2,
        type: "EIP-004"
    },
    comet: {
        tokenId: "0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b",
        decimals: 0,
        name: "Comet",
        type: "EIP-004"
    }
};

export const rsBtcId = TOKENS.rsBTC.tokenId;
export const sigUsdId = TOKENS.sigUSD.tokenId;

export function rsBTC(amount: number) {
    return {
        tokenId: TOKENS.rsBTC.tokenId,
        amount: BigInt(amount)
    };
}
export function sigUSD(amount: number) {
    return {
        tokenId: TOKENS.sigUSD.tokenId,
        amount: BigInt(amount)
    };
}
export function comet(amount: number) {
    return {
        tokenId: TOKENS.comet.tokenId,
        amount: BigInt(amount)
    };
}

export function output(
    pk: KeyedMockChainParty | NonKeyedMockChainParty,
    tokens: OneOrMore<TokenAmount<Amount>>,
    regs: NonMandatoryRegisters | undefined = undefined
) {
    let output = new OutputBuilder(1_000_000n, pk.address).addTokens(tokens);
    if (regs) {
        return output.setAdditionalRegisters(regs);
    } else {
        return output;
    }
}

export function ergOutput(
    pk: KeyedMockChainParty | NonKeyedMockChainParty,
    nanoErg: bigint,
    tokens: OneOrMore<TokenAmount<Amount>>,
    regs: NonMandatoryRegisters | undefined = undefined
) {
    let output = new OutputBuilder(nanoErg, pk.address).addTokens(tokens);
    if (regs) {
        return output.setAdditionalRegisters(regs);
    } else {
        return output;
    }
}

export function expectTokens(
    pk: KeyedMockChainParty | NonKeyedMockChainParty,
    tokens: TokenAmount<bigint>[]
) {
    function sortTokens(tokens: TokenAmount<bigint>[]) {
        return tokens.slice().sort((a, b) => {
            if (a.tokenId < b.tokenId) return -1;
            if (a.tokenId > b.tokenId) return 1;
            return 0;
        });
    }
    const sortedPkTokens = sortTokens(pk.balance.tokens);
    const sortedTokens = sortTokens(tokens);
    expect(sortedPkTokens).toEqual(sortedTokens);
}
