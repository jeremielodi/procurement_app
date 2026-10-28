// backend/src/utils/requisitionDelivery.js
// Informations de livraison d'une réquisition (formulaire de demande d'achat, migration 44) : lecture du corps de requête.
// Création (RequisitionController.create) et correction (RequisitionRevisionService.update).

const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** { address, neededBy, recipient, contact } — champs facultatifs ; date invalide → { error: 'NEEDED_BY_INVALID' } */
function requisitionDelivery(body = {}) {
  const neededBy = text(body.neededBy, 10) || null;
  if (neededBy && (!/^\d{4}-\d{2}-\d{2}$/.test(neededBy) || Number.isNaN(Date.parse(neededBy)))) {
    return { error: 'NEEDED_BY_INVALID' };
  }
  return {
    address: text(body.deliveryAddress, 2000) || null,
    neededBy,
    recipient: text(body.deliveryRecipient, 200) || null,
    contact: text(body.deliveryContact, 255) || null,
  };
}

module.exports = { requisitionDelivery };
