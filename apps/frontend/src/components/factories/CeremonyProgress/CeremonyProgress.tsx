import './CeremonyProgress.scss';
import { FactoryCeremony } from '../../../types/factories.type';

/**
 * Ceremony Progress — MuSig2 step indicator.
 *
 * What it renders
 *   A horizontal stepper visualizing the current FactoryCeremony state
 *   relative to the canonical sequence:
 *     CREATION_STEPS: IDLE → PROPOSED → NONCES_COLLECTED →
 *                      PSIGS_COLLECTED → COMPLETE
 *     ROTATION_STEPS: ROTATING → ROTATE_COMPLETE → REVOKED
 *   Each step shows a checkmark when reached, a spinner on the
 *   current step, and a muted dot for upcoming steps. FAILED states
 *   surface a red mark on the step where the ceremony last advanced.
 *
 *   Used inside FactoryDetail and JoinFactoryModal so a participant
 *   can watch the MuSig2 ceremony advance.
 *
 * Key state
 *   None — derived from the `ceremony` prop.
 *
 * Side effects
 *   None — pure render.
 *
 * Props contract
 *   `ceremony: FactoryCeremony` — the current ceremony enum value.
 */
type CeremonyProgressProps = {
  ceremony: FactoryCeremony;
};

const CREATION_STEPS = [
  FactoryCeremony.IDLE,
  FactoryCeremony.PROPOSED,
  FactoryCeremony.NONCES_COLLECTED,
  FactoryCeremony.PSIGS_COLLECTED,
  FactoryCeremony.COMPLETE,
];

const ROTATION_STEPS = [
  FactoryCeremony.ROTATING,
  FactoryCeremony.ROTATE_COMPLETE,
  FactoryCeremony.REVOKED,
];

const stepLabel = (step: FactoryCeremony) => {
  switch (step) {
    case FactoryCeremony.IDLE: return 'Idle';
    case FactoryCeremony.PROPOSED: return 'Proposed';
    case FactoryCeremony.NONCES_COLLECTED: return 'Nonces';
    case FactoryCeremony.PSIGS_COLLECTED: return 'PSigs';
    case FactoryCeremony.COMPLETE: return 'Complete';
    case FactoryCeremony.ROTATING: return 'Rotating';
    case FactoryCeremony.ROTATE_COMPLETE: return 'Rotated';
    case FactoryCeremony.REVOKED: return 'Revoked';
    case FactoryCeremony.FAILED: return 'Failed';
    default: return step;
  }
};

const CeremonyProgress = ({ ceremony }: CeremonyProgressProps) => {
  const isRotation = ROTATION_STEPS.includes(ceremony);
  const isFailed = ceremony === FactoryCeremony.FAILED;
  const steps = isRotation ? ROTATION_STEPS : CREATION_STEPS;
  const currentIdx = steps.indexOf(ceremony);

  if (isFailed) {
    return (
      <div className='ceremony-progress mb-2'>
        <div className='fs-7 text-light mb-1'>Ceremony</div>
        <span className='badge bg-danger'>Failed</span>
      </div>
    );
  }

  return (
    <div className='ceremony-progress mb-2'>
      <div className='fs-7 text-light mb-1'>Ceremony</div>
      <div className='d-flex align-items-center ceremony-steps'>
        {steps.map((step, idx) => {
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;
          return (
            <div key={step} className='d-flex align-items-center'>
              {idx > 0 && (
                <div className={'ceremony-line ' + (isCompleted ? 'completed' : '')} />
              )}
              <div
                className={
                  'ceremony-dot ' +
                  (isActive ? 'active' : isCompleted ? 'completed' : 'pending')
                }
                title={stepLabel(step)}
              >
                <span className='ceremony-label'>{stepLabel(step)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CeremonyProgress;
