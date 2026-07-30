(() => {
  "use strict";

  const sizeTiers = [
    { key: "underA4", label: "A4 미만", price: 10000, aliases: ["A4 미만"] },
    { key: "halfPage", label: "A4 ~ 신문지 한 면의 절반", price: 20000, aliases: ["A4 ~ 신문지 한 면의 절반", "A4 ~ 신문지 한 면의 절반 이하"] },
    { key: "onePage", label: "신문지 한 면의 절반 ~ 한 면", price: 40000, aliases: ["신문지 한 면의 절반 ~ 한 면", "신문지 한 면의 절반 초과 ~ 신문지 한 면", "절반 초과"] },
    { key: "fullSheet", label: "신문지 한 면 ~ 두 면(전지)", price: 60000, aliases: ["신문지 한 면 ~ 두 면(전지)", "신문지 한 면보다 큰 작품"] },
    { key: "overFullSheet", label: "신문지 두 면(전지) 이상", price: 100000, aliases: ["신문지 두 면(전지) 이상"] }
  ];

  const characterTiers = [
    { key: "short", title: "짧게", label: "30자 미만", min: 0, max: 29, price: 10000 },
    { key: "medium", title: "보통", label: "30 ~ 60자", min: 30, max: 59, price: 20000 },
    { key: "long", title: "길게", label: "60 ~ 90자", min: 60, max: 89, price: 40000 },
    { key: "veryLong", title: "매우 길게", label: "90 ~ 120자", min: 90, max: 119, price: 60000 },
    { key: "ultraLong", title: "120자 이상", label: "120자 이상", min: 120, max: Number.POSITIVE_INFINITY, price: 100000 }
  ];

  const money = value => Number(value || 0).toLocaleString("ko-KR") + "원";
  const countCharacters = text => String(text || "").replace(/\s/g, "").length;

  function getSizeTier(workSize) {
    const value = String(workSize || "").trim();
    if (!value || value === "함께 상의") return sizeTiers[0];
    return sizeTiers.find(tier => tier.aliases.some(alias => value.includes(alias))) || sizeTiers[0];
  }

  function getCharacterTier(value) {
    const count = typeof value === "number" ? value : countCharacters(value);
    return characterTiers.find(tier => count >= tier.min && count <= tier.max) || characterTiers[characterTiers.length - 1];
  }

  function calculate(workSize, sentenceOrCount) {
    const count = typeof sentenceOrCount === "number" ? sentenceOrCount : countCharacters(sentenceOrCount);
    const sizeTier = getSizeTier(workSize);
    const characterTier = getCharacterTier(count);
    const applied = sizeTier.price >= characterTier.price
      ? { type: "작품 크기", label: sizeTier.label, price: sizeTier.price }
      : { type: "글자 수", label: characterTier.label, price: characterTier.price };
    return { count, sizeTier, characterTier, applied, price: applied.price };
  }

  window.GEULGYEOL_PRICING = Object.freeze({
    sizeTiers, characterTiers, money, countCharacters, getSizeTier, getCharacterTier, calculate,
    areaNotice: "※ 지정규격이 아닌 가로세로 비율이 달라질 때 동일 면적 기준으로 적용합니다.",
    multipleNotice: "같은 내용의 작품을 여러 장 제작하는 경우에는 수량과 작업 방식에 따라 비용을 협의하여 조정합니다."
  });
})();
