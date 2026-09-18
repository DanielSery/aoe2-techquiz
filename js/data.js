/* Classic script, not a module: index.html has to work opened straight off
   disk, where module loading and fetch are both blocked. */
window.Quiz = window.Quiz || {};

window.Quiz.shuffle = function (items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

window.Quiz.buildDeck = function (data, topicIds) {
  const cards = [];
  for (const topic of data.topics) {
    if (!topicIds.includes(topic.id)) continue;
    for (const civId of Object.keys(data.civs)) {
      if (topic.civs[civId]) cards.push({ topicId: topic.id, civId });
    }
  }
  return window.Quiz.shuffle(cards);
};

window.Quiz.truth = function (data, card) {
  const topic = data.topics.find((t) => t.id === card.topicId);
  return { topic, civ: data.civs[card.civId], answer: topic.civs[card.civId] };
};
