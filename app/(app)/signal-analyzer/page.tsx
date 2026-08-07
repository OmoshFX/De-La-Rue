import { Activity } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function SignalAnalyzerPage() {
  return (
    <ComingSoon
      title="Signal Analyzer"
      description="Scan symbols for setups that match your own rules."
      icon={Activity}
    />
  );
}
