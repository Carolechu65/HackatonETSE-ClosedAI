"""Run inside the pinned OCR image with /adapter on PYTHONPATH."""
import unittest
from types import SimpleNamespace
from alarmat_ocr import date_proposal, receipt_transcript_warnings

class ReceiptAdapterTests(unittest.TestCase):
    def test_receipt_separator_is_not_model_repetition(self):
        self.assertEqual(receipt_transcript_warnings('SUPERMERCADO SOL\n' + '-' * 40 + '\nTOTAL 13,00'), [])
        self.assertTrue(receipt_transcript_warnings('A' * 40))
        self.assertTrue(receipt_transcript_warnings('\n'.join(['same'] * 9)))

    def test_date_with_time_keeps_receipt_calendar_date(self):
        self.assertEqual(date_proposal(SimpleNamespace(text='22/10/2026 18:35')), '2026-10-22')
        self.assertEqual(date_proposal(SimpleNamespace(text='2026-10-22T18:35:59')), '2026-10-22')

    def test_date_never_guesses_invalid_or_embedded_values(self):
        for value in ('31/02/2026 18:35', '10/11', '10/11/2026 or 11/10/2026', '12322/10/2026'):
            self.assertIsNone(date_proposal(SimpleNamespace(text=value)))

if __name__ == '__main__':
    unittest.main()
