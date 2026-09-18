export async function loadData() {
  const response = await fetch("data/topics.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`topics.json: ${response.status}`);
  return response.json();
}

export function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildDeck(data, topicIds) {
  const cards = [];
  for (const topic of data.topics) {
    if (!topicIds.includes(topic.id)) continue;
    for (const civId of Object.keys(data.civs)) {
      if (topic.civs[civId]) cards.push({ topicId: topic.id, civId });
    }
  }
  return shuffle(cards);
}

export function truth(data, card) {
  const topic = data.topics.find((t) => t.id === card.topicId);
  return { topic, civ: data.civs[card.civId], answer: topic.civs[card.civId] };
}
