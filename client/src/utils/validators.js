// src/utils/validators.js
export const validateEmail = (email) => {
  const re = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/
  return re.test(email)
}

export const validatePhone = (phone) => {
  const re = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,3}[)]?[-\s\.]?[0-9]{3,4}[-\s\.]?[0-9]{3,4}$/
  return re.test(phone)
}

export const validateAmount = (amount) => {
  return amount > 0 && !isNaN(amount)
}

export const validateQuantity = (quantity) => {
  return Number.isInteger(quantity) && quantity > 0
}