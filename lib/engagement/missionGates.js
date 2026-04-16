'use strict';

function tagCountsForMission(def, gameDef) {
    if (!gameDef || gameDef.enabled === false) return false;
    if (!def.allowBroaderPool) return gameDef.missionEligible === true;
    return gameDef.missionEligible === true || gameDef.category === 'social';
}

module.exports = { tagCountsForMission };
