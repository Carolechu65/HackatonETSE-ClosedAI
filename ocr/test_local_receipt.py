import unittest
from local_receipt import parse_receipt_text, amount

class LocalReceiptTests(unittest.TestCase):
    def test_total_is_not_subtotal_cash_or_change(self):
        fields, warnings = parse_receipt_text('SUPERMERCADO OLIVO\n24/10/2026 00:35\nSUBTOTAL 23,64\nTOTAL EUR 28,60\nEFECTIVO 50,00\nCAMBIO 21,40\nCUOTA IVA 4,96')
        self.assertEqual(fields['merchant']['value'], 'SUPERMERCADO OLIVO')
        self.assertEqual(fields['purchased_on']['value'], '2026-10-24')
        self.assertEqual(fields['total']['value'], '28.60')
        self.assertEqual(fields['tax_amount']['value'], '4.96')
        self.assertEqual(fields['currency']['value'], 'EUR')
        self.assertTrue(all(f['verification'] == 'unverified' for f in fields.values()))

    def test_does_not_invent_total_from_card_or_subtotal(self):
        for receipt in ['SUBTOTAL 5,00\nTARJETA 6,05', 'TOTAL IVA 1,05', 'TOTAL DESCUENTO 1,20', 'TOTAL ARTICULOS 3,00', 'TOTAL 0,00', 'TOTAL -12,50']:
            fields, _ = parse_receipt_text(receipt)
            self.assertIsNone(fields['total']['value'])

    def test_conflicting_totals_require_manual_review(self):
        fields, warnings = parse_receipt_text('TOTAL EUR 12,20\nTOTAL EUR 17,90')
        self.assertIsNone(fields['total']['value'])
        self.assertIn({'code': 'ambiguous_total'}, warnings)
        repeated, _ = parse_receipt_text('TOTAL EUR 12,20\nTOTAL EUR 12,20')
        self.assertEqual(repeated['total']['value'], '12.20')

    def test_split_total_and_amount_are_adjacent(self):
        fields, _ = parse_receipt_text('TOTAL A PAGAR\n18,90 EUR\nTARJETA 18,90')
        self.assertEqual(fields['total']['value'], '18.90')
        fields, _ = parse_receipt_text('TOTAL\nTARJETA 18,90')
        self.assertIsNone(fields['total']['value'])

    def test_ambiguous_or_impossible_dates_are_not_chosen(self):
        fields, warnings = parse_receipt_text('24/10/2026\n25/10/2026\nTOTAL 4,20')
        self.assertIsNone(fields['purchased_on']['value'])
        self.assertIn({'code': 'ambiguous_date'}, warnings)
        fields, _ = parse_receipt_text('31/02/2026\nTOTAL 4,20')
        self.assertIsNone(fields['purchased_on']['value'])

    def test_foreign_currency_is_explicit_and_ambiguity_does_not_default_to_eur(self):
        fields, _ = parse_receipt_text('TOTAL USD 12.00')
        self.assertEqual(fields['currency']['value'], 'USD')
        for receipt in ['TOTAL $ 12.00', 'TOTAL EUR 12.00\nEquivalent USD 13.20']:
            fields, warnings = parse_receipt_text(receipt)
            self.assertEqual(fields['currency']['value'], 'UNKNOWN')
            self.assertIn({'code': 'currency_needs_review'}, warnings)
        fields, _ = parse_receipt_text('TOTAL 12.00')
        self.assertIsNone(fields['currency']['value'])

    def test_amounts_preserve_cents_without_guessing_malformed_separators(self):
        self.assertEqual(amount('1.234,56'), '1234.56')
        self.assertEqual(amount('1,234.56'), '1234.56')
        for raw in ['12', '1.2', '12.00 34.00', '1,23,45', '123456789.00']:
            self.assertIsNone(amount(raw))

if __name__ == '__main__':
    unittest.main()
