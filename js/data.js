/* Classic script, not a module: index.html has to work opened straight off
   disk, where module loading and fetch are both blocked. The body is wrapped so
   only what Quiz names is shared. */
window.Quiz = window.Quiz || {};

(function (Quiz) {
  Quiz.shuffle = function (items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  /* A round is one pass over the civilisations: one card each, per topic. */
  Quiz.buildDeck = function (data, topicIds) {
    const cards = [];
    for (const topic of data.topics) {
      if (!topicIds.includes(topic.id) || !asksOf(topic)) continue;
      for (const civId of Object.keys(data.civs)) {
        if (topic.civs[civId]) cards.push({ topicId: topic.id, civId });
      }
    }
    return Quiz.shuffle(cards);
  };

  /* Every civ is worth asking, including the ones with no unit at all: "what
     does it have" answered with a ✗ and the techs it owns anyway is exactly the
     fact worth knowing. A topic with nothing to claim is not a board. */
  function asksOf(topic) {
    return topic.upgrades.length > 0;
  }

  Quiz.truth = function (data, card) {
    const topic = data.topics.find((t) => t.id === card.topicId);
    return { topic, civ: data.civs[card.civId], answer: topic.civs[card.civId] };
  };
})(window.Quiz);
