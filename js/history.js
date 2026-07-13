function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

export function prunePlanHistory(history, today) {
  const minimum = dayNumber(today) - 6;
  return [...history].filter((plan) => dayNumber(plan.date) >= minimum && plan.date <= today).sort((a, b) => b.date.localeCompare(a.date));
}

export function mergePlanHistory(history, plan, today) {
  return prunePlanHistory(history.filter((item) => item.date !== plan.date).concat(structuredClone(plan)), today);
}
