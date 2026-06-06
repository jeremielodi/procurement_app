# Full test with error checking
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:5000/api/requisitions \
  -H "Content-Type: application/json" \
  -d '{
    "title": "IT Equipment Requisition",
    "description": "Laptops and monitors for new team members",
    "amount": 5000.00,
    "currency": "USD",
    "priority": "high",
    "requester": "John Doe",
    "items": []
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 200 ]; then
  echo "✅ Requisition created successfully!"
else
  echo "❌ Failed to create requisition"
fi
