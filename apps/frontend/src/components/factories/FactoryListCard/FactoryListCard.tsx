import './FactoryListCard.scss';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';

/**
 * Factory List Card — animated sub-view router for /factories.
 *
 * What it renders
 *   A single Card whose contents swap among three sub-views based on
 *   the URL splat:
 *     /factories          → FactoryList (default)
 *     /factories/create   → FactoryCreate wizard
 *     /factories/<iid>    → FactoryDetail for that factory
 *   Framer-Motion AnimatePresence drives the slide+fade transition
 *   between the three.
 *
 * Key state
 *   None — view selection is derived from useParams() splat + Redux
 *   factories list.
 *
 * Side effects
 *   - navigate('/factories') for child onClose handlers
 *   - navigate('/factories/<iid>') for row clicks (FactoryList)
 *   - navigate('/factories/create') for the Host CTA
 *
 * Props contract
 *   None — sub-view + selection is resolved from the route.
 */

import { useSelector } from 'react-redux';
import { TRANSITION_DURATION } from '../../../utilities/constants';
import { selectFactories } from '../../../store/factoriesSelectors';
import FactoryList from '../FactoryList/FactoryList';
import FactoryDetail from '../FactoryDetail/FactoryDetail';
import FactoryCreate from '../FactoryCreate/FactoryCreate';

const FactoryListCard = () => {
  const navigate = useNavigate();
  const params = useParams();
  const subPath = params['*'] || '';
  const factories = useSelector(selectFactories);

  const selFactory = (subPath && subPath !== 'create')
    ? (factories?.find(f => f.instance_id === subPath) || null)
    : null;

  const selView = subPath === 'create' ? 'create'
    : selFactory ? 'detail'
    : 'list';

  return (
    <Card className='h-100 overflow-hidden inner-box-shadow' data-testid='factory-list-card'>
      <AnimatePresence mode='wait'>
        <motion.div
          key={selView}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: TRANSITION_DURATION }}
          className='h-100 overflow-hidden'
        >
          {selView === 'create' ? (
            <FactoryCreate onClose={() => navigate('/factories')} />
          ) : selView === 'detail' && selFactory ? (
            <FactoryDetail
              factory={selFactory}
              onClose={() => navigate('/factories')}
            />
          ) : (
            <FactoryList
              onCreateFactory={() => navigate('/factories/create')}
              onFactoryClick={(factory) => navigate(`/factories/${factory.instance_id}`)}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </Card>
  );
};

export default FactoryListCard;
