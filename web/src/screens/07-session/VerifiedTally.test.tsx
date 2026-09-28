import { render, screen } from '@testing-library/react'
import { VerifiedTally } from './LiveShell'

test('compact tally pluralises the noun by the count (review 28 Sep: "1 pegs")', () => {
  const { rerender } = render(<VerifiedTally compact total={1} unverified={0} noun="peg" />)
  expect(screen.getByLabelText('Verified and unverified counts')).toHaveTextContent('1 verified · 0 unverified · 1 peg')
  expect(screen.getByLabelText('Verified and unverified counts')).not.toHaveTextContent('1 pegs')
  rerender(<VerifiedTally compact total={5} unverified={1} noun="peg" />)
  expect(screen.getByLabelText('Verified and unverified counts')).toHaveTextContent('4 verified · 1 unverified · 5 pegs')
})

test('full tally labels one reach as "reach", several as "reaches"', () => {
  const { rerender } = render(<VerifiedTally total={1} unverified={0} noun="reach" />)
  expect(screen.getByText('reach')).toBeInTheDocument()
  expect(screen.queryByText('reaches')).not.toBeInTheDocument()
  rerender(<VerifiedTally total={3} unverified={0} noun="reach" />)
  expect(screen.getByText('reaches')).toBeInTheDocument()
})
