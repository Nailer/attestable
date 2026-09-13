# Demo video script

About 5 minutes. Your face stays in the corner the whole time. The screen shows the app.

---

## Before you hit record

- Open https://nailer.github.io/attestable/ and let it finish loading
- Connect your wallet **now**, not on camera
- Settings tab: Timestamps = **UTC**, Auto-refresh = **Off**
- Open a second browser tab with the Blockscout link at the bottom of this page, already on the **Internal txns** view
- **Do not settle cover #6.** That is your live moment and it only works once

---

## 0:00 — Who you are, and the problem

**Screen: the top of the app.**

Say:

> Hi, I'm Emmanuel. I built Attestable.
>
> Most apps in crypto depend on a price feed — something that tells them what Ethereum is worth right now. When that feed stops updating, the app has to freeze. It can't lend, it can't close bad positions, it just sits there losing money.
>
> Everybody can already see when a feed stops. That's not the problem. The problem is that nobody pays for it. The company running the feed never promised you anything, so the loss just sits on you.
>
> Attestable is insurance for exactly that.

---

## 0:35 — Show the app

**Screen: the list of covers.**

Say:

> This is it, running live on Creditcoin. Every row here is one policy. Someone is covered, someone is backing them, and there's real money locked in each one.

Do:

1. Point at the numbers along the top — how many covers, how many settled, how much money is held
2. Scroll down the list slowly

---

## 1:00 — How you create a policy

**Screen: click "Write a cover".**

Say:

> This is how you make one. Here I'm the person taking on the risk.
>
> I choose how long the cover runs. I choose how quiet the feed is allowed to go before it counts as broken — I'll use 90 minutes. I put up the money I'm willing to lose, and I set the fee I'm charging for it.
>
> One thing I want to show you. This feed's own documentation says it updates every 60 minutes. When I actually measured it, the real worst gap on a completely normal day was 61.6 minutes. So if I had trusted the documentation and set 60, I'd be paying people out on a feed that was working perfectly fine.
>
> That warning is on the screen because I got it wrong first, and measuring is what caught it.

Do:

1. Click **Write a cover**
2. Point at each box as you mention it — duration, then tolerance, then your money, then your fee
3. Point at the orange warning about 61.6 minutes

Optional, if you want to create one on camera: click **Post 200 tCTC and open the cover** and approve in your wallet.

---

## 1:45 — Where the proof comes from

**Screen: click "Evidence Explorer".**

Say:

> So where does the proof come from?
>
> Every price Chainlink publishes on Ethereum can be proven. First, they publish it. Second, Creditcoin's proof system confirms that it really was in that Ethereum block. Third, my contract checks it — did that transaction actually succeed, and did the price come from the right place.
>
> That last check matters more than it sounds. Anyone can write their own contract, put a fake price in it, and get a completely real proof of that fake price. The proof would be genuine. The price would be worthless. So I check where it came from, and I tested that attack against the live network. It got rejected.

Do:

1. Click **Evidence Explorer**
2. Move down steps 1, 2, 3, 4 — about a second on each

**Careful:** don't open cover #1. Its number is wrong — that's a bug I found and fixed today.

---

## 2:30 — Settle one, live

**Screen: Coverage tab, cover #6.**

Say:

> Let me settle one right now.
>
> This cover's time is up. Right now the contract has no proof for it at all, so it assumes the worst — it treats the whole 80 minutes as one long silence.
>
> Watch this number.

Do:

1. Click **Coverage**, then cover **#6**
2. Point at **80.0 min observed / 90.0 min allowed**
3. Click **Fetch and submit evidence** and approve in your wallet — one prompt, about 30 seconds

Say, once it lands:

> There. One real Chainlink update, proven. The silence just dropped from 80 minutes to 41, because now I can show the feed was alive in the middle of the window.

Do:

4. Click **Settle this cover** and approve

Say:

> Healthy. The feed did its job, so the person backing it keeps their money and takes the fee. I didn't decide that. The contract did.

**If anything goes wrong:** use cover **#4** instead. Same steps, also settles healthy.

---

## 3:30 — A real one that paid out

**Screen: switch to your Blockscout tab.**

Say:

> That one was healthy. Here's one that wasn't.
>
> On the 31st of August this feed really did go down. It went quiet for nearly 13 hours. I wrote a policy over that exact window and let it settle itself.
>
> Look at what moved. 200 went to the person who was covered. 12 went to the person backing them — because even when they lose, they keep the fee they charged for taking the risk. And that call at the top is the contract asking Creditcoin whether the outage could even be proven, before it agreed to pay anything.
>
> Nobody approved this. No forms, no waiting, no arguing about whether it counted.

Do:

1. Switch to the Blockscout tab
2. Point at the three rows one at a time

**Careful:** stay on **Internal txns**. The Details tab shows 0 and makes it look like nothing happened.

---

## 4:15 — What it can't do

**Screen: click "Trust Boundary".**

Say:

> Last thing, and I think it's the most important one.
>
> Chainlink isn't part of this. They didn't sign anything, they don't get paid, they don't need to know I exist. It's like insuring against rain — you don't need the sky's permission.
>
> I don't check whether the price was correct, only whether it showed up. And I can't prove something never happened. What I can prove is that no valid proof arrived in time, at a point where it easily could have.
>
> This whole page is the list of things I don't claim. I'd rather tell you myself than have you find it.

Do:

1. Click **Trust Boundary**
2. Move down the right-hand column — the one with the crosses
3. Stop moving. Hold for two seconds. Stop recording.

---

## If they ask you something

**Why is the data on Ethereum in the first place?**

> Because it's already there. Chainlink publishes it for their own reasons. I didn't create it, I can't change it, and I can't fake it. That's what makes it worth trusting.

**Is there really a market for this?**

> Honestly, it's unproven. The risk is real and I've measured it, but nobody is buying this kind of cover today and I have no customers yet. My next step isn't code, it's finding one lending protocol that's already been hurt by this and remembers it.

**What's left to build?**

> Covering more than one chain in a single policy. Ethereum mainnet already works with Creditcoin and I checked the feed resolves — I just couldn't get the data access to finish it in time, so I left it out rather than ship something half-done.

**What's the odd number on cover #1?**

> A bug in my own code, found today. My scanner was looking at a fixed range of blocks instead of the actual policy window, so it missed some updates at the start and invented an outage that never happened. I fixed it, and I left that cover unsettled rather than pay out on a number I knew was wrong.

---

## Links

- App — https://nailer.github.io/attestable/
- The payout on Blockscout — https://creditcoin-testnet.blockscout.com/tx/0xdf52e5adbb2ba5677225f4514981989f5730482cccc2fa11420c0ec5613f28cd?tab=internal
- Code — https://github.com/Nailer/attestable
