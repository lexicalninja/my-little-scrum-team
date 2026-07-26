---
name: test-writer
description: Writes comprehensive test cases including unit tests, integration tests, and E2E tests. Supports two modes - writing tests from design specs/requirements OR generating tests by analyzing existing code. Creates tests that cover happy paths, edge cases, error conditions, and follow testing best practices.
---

# Test Writer Skill

## Modes

This skill operates in two modes:

1. **Requirement-Based**: Write tests from task requirements or design specifications
2. **Code-Analysis**: Generate tests by analyzing existing code

## Instructions

### Mode 1: Requirement-Based Testing

1. Analyze test requirements from task
2. Identify what needs to be tested (functions, components, endpoints)
3. Write unit tests for individual functions/components
4. Write integration tests for component interactions
5. Write E2E tests for user flows (if applicable)
6. Cover happy paths, edge cases, and error conditions

### Mode 2: Code-Analysis Testing

1. Analyze the code to understand what needs testing
2. Identify test cases from code behavior:
   - Happy path scenarios
   - Edge cases (empty inputs, null values, boundary conditions)
   - Error conditions and exception handling
   - Integration points and dependencies
3. Generate tests following project conventions
4. Add comments explaining complex test scenarios

## Output Format

Return test implementation with:
- Test files with appropriate naming
- Test cases covering all scenarios
- Setup and teardown where needed
- Mocking for external dependencies
- Clear assertions and expectations

## Test Types

- **Unit Tests**: Test individual functions/components in isolation
- **Integration Tests**: Test component interactions, API integrations
- **E2E Tests**: Test complete user flows
- **Snapshot Tests**: Test component rendering (if applicable)
- **Performance Tests**: Test performance characteristics (if needed)

## Test Coverage Areas

- **Happy Paths**: Normal, expected behavior
- **Edge Cases**: Boundary conditions, empty inputs, null values
- **Error Conditions**: Invalid inputs, error handling
- **State Changes**: Component state transitions
- **User Interactions**: Click, input, navigation
- **API Responses**: Success and error responses

## Examples

### Example 1: Requirement-Based (JavaScript)

**Input:** "Write tests for calculateTotal function"

**Output:**
```javascript
// tests/utils.test.js
describe('calculateTotal', () => {
    test('calculates total for valid items array', () => {
        const items = [
            { price: 10.00 },
            { price: 20.00 },
            { price: 5.00 }
        ];
        expect(calculateTotal(items)).toBe(35.00);
    });

    test('returns 0 for empty array', () => {
        expect(calculateTotal([])).toBe(0);
    });

    test('returns 0 for null input', () => {
        expect(calculateTotal(null)).toBe(0);
    });

    test('handles items with zero price', () => {
        const items = [{ price: 10.00 }, { price: 0 }, { price: 5.00 }];
        expect(calculateTotal(items)).toBe(15.00);
    });
});
```

### Example 2: Code-Analysis (Python)

**Input (existing code):**
```python
def divide(a, b):
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
```

**Output:**
```python
import pytest
from calculator import divide

class TestDivide:
    """Test suite for divide function."""

    def test_divide_positive_numbers(self):
        """Test dividing two positive numbers."""
        assert divide(10, 2) == 5.0
        assert divide(9, 3) == 3.0

    def test_divide_negative_numbers(self):
        """Test dividing negative numbers."""
        assert divide(-10, 2) == -5.0
        assert divide(10, -2) == -5.0

    def test_divide_by_zero_raises_error(self):
        """Test that dividing by zero raises ValueError."""
        with pytest.raises(ValueError, match="Cannot divide by zero"):
            divide(10, 0)

    def test_divide_float_result(self):
        """Test that division returns float when result is decimal."""
        assert divide(7, 2) == 3.5

    def test_divide_zero_numerator(self):
        """Test dividing zero by non-zero number."""
        assert divide(0, 5) == 0.0
```

### Example 3: Code-Analysis (JavaScript)

**Input (existing code):**
```javascript
function validateEmail(email) {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

**Output:**
```javascript
describe('validateEmail', () => {
    test('returns true for valid email addresses', () => {
        expect(validateEmail('user@example.com')).toBe(true);
        expect(validateEmail('test.email+tag@domain.co.uk')).toBe(true);
    });

    test('returns false for invalid email addresses', () => {
        expect(validateEmail('invalid')).toBe(false);
        expect(validateEmail('@example.com')).toBe(false);
        expect(validateEmail('user@')).toBe(false);
    });

    test('returns false for empty or null input', () => {
        expect(validateEmail('')).toBe(false);
        expect(validateEmail(null)).toBe(false);
        expect(validateEmail(undefined)).toBe(false);
    });
});
```

## Best Practices

- **Independent Tests**: Each test should be independent and isolated
- **Clear Names**: Descriptive test names that explain what is being tested
- **Arrange-Act-Assert**: Follow AAA pattern
- **Mock External Dependencies**: Mock APIs, databases, external services
- **Test One Thing**: Each test should verify one behavior
- **Fast Tests**: Tests should run quickly
- **Maintainable**: Tests should be easy to understand and maintain

## Framework-Specific Guidelines

- **Jest/Mocha**: Use `describe`/`it` or `test` blocks
- **pytest**: Use `test_` prefix, `pytest.fixture` for setup
- **JUnit**: Use `@Test` annotation, `@BeforeEach` for setup
- **Go**: Use `TestXxx` naming, `t.Run` for subtests
