import { Calculator } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function RiskCalculatorPage() {
  return (
    <ComingSoon
      title="Risk Calculator"
      description="Work out position size and exposure before you place a trade."
      icon={Calculator}
    />
  );
}
