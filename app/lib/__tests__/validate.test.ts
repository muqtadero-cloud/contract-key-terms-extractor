import { validateExtraction, validateExtractions, generateValidationReport } from '../validate';
import { Extraction } from '../schema';

describe('validateExtraction', () => {
  const sampleText = `
    This is a contract agreement.

    Payment terms: All payments shall be made within 30 days of invoice date.
    The buyer agrees to pay the full amount without deduction.

    Shipping: Products will be shipped FOB origin.
    Seller is not responsible for shipping damage.
  `;

  test('should validate exact quote match', () => {
    const extraction: Extraction = {
      field: 'Payment',
      status: 'found',
      quote: 'All payments shall be made within 30 days of invoice date.',
      page: 1,
      start: null,
      end: null,
      confidence: 0.9
    };

    const result = validateExtraction(extraction, sampleText);

    expect(result.status).toBe('found');
    expect(result.start).not.toBeNull();
    expect(result.end).not.toBeNull();
    expect(result.confidence).toBe(0.9);
  });

  test('should handle quote not found in text', () => {
    const extraction: Extraction = {
      field: 'Tax',
      status: 'found',
      quote: 'This text does not exist in the contract.',
      page: 1,
      start: null,
      end: null,
      confidence: 0.8
    };

    const result = validateExtraction(extraction, sampleText);

    expect(result.status).toBe('not_found');
    expect(result.quote).toBe('');
    expect(result.start).toBeNull();
    expect(result.end).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('should handle normalized whitespace differences', () => {
    const extraction: Extraction = {
      field: 'Shipping',
      status: 'found',
      quote: 'Products   will   be   shipped   FOB   origin.',
      page: 1,
      start: null,
      end: null,
      confidence: 0.85
    };

    const result = validateExtraction(extraction, sampleText);

    expect(result.status).toBe('found');
    expect(result.confidence).toBeLessThan(0.85); // Should be reduced
  });

  test('should not validate already not_found extractions', () => {
    const extraction: Extraction = {
      field: 'Discount',
      status: 'not_found',
      quote: '',
      page: null,
      start: null,
      end: null,
      confidence: 0
    };

    const result = validateExtraction(extraction, sampleText);

    expect(result.status).toBe('not_found');
    expect(result.quote).toBe('');
  });
});

describe('validateExtractions', () => {
  const sampleText = 'Payment is due in 30 days. Shipping is free.';

  test('should validate multiple extractions', () => {
    const extractions: Extraction[] = [
      {
        field: 'Payment',
        status: 'found',
        quote: 'Payment is due in 30 days.',
        page: 1,
        start: null,
        end: null,
        confidence: 0.9
      },
      {
        field: 'Shipping',
        status: 'found',
        quote: 'Shipping is free.',
        page: 1,
        start: null,
        end: null,
        confidence: 0.9
      },
      {
        field: 'Tax',
        status: 'found',
        quote: 'This does not exist.',
        page: 1,
        start: null,
        end: null,
        confidence: 0.8
      }
    ];

    const results = validateExtractions(extractions, sampleText);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('found');
    expect(results[1].status).toBe('found');
    expect(results[2].status).toBe('not_found');
  });
});

describe('generateValidationReport', () => {
  test('should generate correct validation report', () => {
    const original: Extraction[] = [
      {
        field: 'Payment',
        status: 'found',
        quote: 'Valid quote',
        page: 1,
        start: 0,
        end: 10,
        confidence: 0.9
      },
      {
        field: 'Tax',
        status: 'found',
        quote: 'Invalid quote',
        page: 1,
        start: 0,
        end: 10,
        confidence: 0.8
      }
    ];

    const validated: Extraction[] = [
      {
        field: 'Payment',
        status: 'found',
        quote: 'Valid quote',
        page: 1,
        start: 0,
        end: 10,
        confidence: 0.9
      },
      {
        field: 'Tax',
        status: 'not_found',
        quote: '',
        page: null,
        start: null,
        end: null,
        confidence: 0
      }
    ];

    const report = generateValidationReport(original, validated);

    expect(report.totalExtractions).toBe(2);
    expect(report.validCount).toBe(1);
    expect(report.invalidCount).toBe(1);
    expect(report.invalidFields).toEqual(['Tax']);
  });
});
