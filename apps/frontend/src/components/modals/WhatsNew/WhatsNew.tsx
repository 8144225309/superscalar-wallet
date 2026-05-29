import './WhatsNew.scss';
import { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';

import { CloseSVG } from '../../../svgs/Close';
import logger from '../../../services/logger.service';
import { RootService } from '../../../services/http.service';
import { setShowModals } from '../../../store/rootSlice';
import { selectShowModals } from '../../../store/rootSelectors';

interface ChangelogGroup {
  name: string;
  items: string[];
}

interface ChangelogSection {
  version: string;
  date?: string;
  groups: ChangelogGroup[];
}

const LAST_SEEN_KEY = 'soupwallet:lastSeenChangelogVersion';

export function getLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* localStorage can be disabled (private mode); no-op rather than
     * surface an error — the "what's new" feature just loses memory
     * across reloads in that case. */
  }
}

const WhatsNew = () => {
  const dispatch = useDispatch();
  const showModals = useSelector(selectShowModals);
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<ChangelogSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showModals.whatsNewModal) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    RootService.getChangelog()
      .then((data: { sections: ChangelogSection[] }) => {
        if (cancelled) return;
        setSections(data.sections || []);
        /* Mark the newest section as seen so the indicator dot clears. */
        const newest = data.sections?.[0]?.version;
        if (newest) setLastSeenVersion(newest);
      })
      .catch((err: any) => {
        if (cancelled) return;
        logger.error('Changelog fetch failed: ' + JSON.stringify(err));
        setError('Could not load changelog.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showModals.whatsNewModal]);

  const closeHandler = () => {
    dispatch(setShowModals({ ...showModals, whatsNewModal: false }));
  };

  const lastSeen = getLastSeenVersion();

  return (
    <Modal
      show={showModals.whatsNewModal}
      onHide={closeHandler}
      centered
      className='modal-lg whats-new-modal'
      data-testid='whats-new-modal'
    >
      <Modal.Header className='d-flex align-items-start justify-content-between pb-0 border-0'>
        <h4 className='text-blue fw-bold mb-0'>What&apos;s new</h4>
        <span className='span-close-svg' onClick={closeHandler} data-testid='whats-new-close'>
          <CloseSVG />
        </span>
      </Modal.Header>
      <Modal.Body className='py-2'>
        {loading && (
          <div className='changelog-empty'>
            <Spinner animation='border' size='sm' className='me-2' />
            Loading changelog…
          </div>
        )}
        {error && !loading && (
          <div className='changelog-empty text-danger' data-testid='whats-new-error'>
            {error}
          </div>
        )}
        {!loading && !error && sections && sections.length === 0 && (
          <div className='changelog-empty' data-testid='whats-new-empty'>
            No changelog entries yet.
          </div>
        )}
        {!loading && !error && sections && sections.map((section, idx) => {
          const isNewerThanSeen = lastSeen && idx === 0 && section.version !== lastSeen;
          const isFirstAndUnseen = !lastSeen && idx === 0;
          const isNew = isNewerThanSeen || isFirstAndUnseen;
          return (
            <div
              key={section.version}
              className='changelog-section'
              data-testid={`whats-new-section-${section.version}`}
            >
              <div className='changelog-section-header'>
                {section.version}
                {section.date && <span className='changelog-section-date'>{section.date}</span>}
                {isNew && <span className='changelog-section-new-tag'>NEW</span>}
              </div>
              {section.groups.map(group => (
                <div key={group.name} className='changelog-group'>
                  <div className='changelog-group-name'>{group.name}</div>
                  <ul>
                    {group.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          );
        })}
      </Modal.Body>
    </Modal>
  );
};

export default WhatsNew;
