import { Fragment, useId, useState, type ReactNode } from 'react';
import { formatFuzzyDate, isDateKnown } from '../model/dates';
import { displayName, initials, lifespan } from '../model/names';
import {
  getAssociations,
  getChildGroups,
  getDerivedStepParents,
  getParents,
  getPortrait,
  getSiblings,
  type TreeIndex,
} from '../model/relatives';
import { addMedia, describePersonRemoval, removeMedia, removePerson, setPortrait, updateMedia } from '../model/tree';
import type { Association, FamilyTreeDocument, Id, LifeEvent, ParentLink, Partnership, Person } from '../model/types';
import { ImageError, mediaDataUrl, prepareImage } from '../media/image';
import type { RelationType } from './AddRelativeDialog';
import { EditIcon, PhotoIcon, PlusIcon, TargetIcon, TrashIcon } from './icons';
import {
  ALTERNATE_NAME_LABELS,
  END_REASON_LABELS,
  LIVING_LABELS,
  PARENT_KIND_LABELS,
  PARTNERSHIP_KIND_LABELS,
  SEX_LABELS,
  SIBLING_LABELS,
} from './labels';
import { Markdown } from './Markdown';
import { Menu } from './Menu';
import { ConfirmDialog } from './Modal';

type Apply = (label: string, change: (tree: FamilyTreeDocument) => FamilyTreeDocument) => string | undefined;

interface Props {
  index: TreeIndex;
  person: Person;
  onSelect: (id: Id) => void;
  onEdit: () => void;
  onShowInTree: () => void;
  onAddRelative: (relation: RelationType) => void;
  onEditParentLink: (link: ParentLink) => void;
  onEditPartnership: (partnership: Partnership) => void;
  onRemoveAssociation: (association: Association) => void;
  onApply: Apply;
  onDeleted: () => void;
  announce: (message: string) => void;
}

function PersonLink({ person, onSelect, meta }: { person: Person; onSelect: (id: Id) => void; meta?: ReactNode }) {
  return (
    <span className="relative-link-wrap">
      <button type="button" className="relative-link" onClick={() => onSelect(person.id)}>
        <span className="relative-name">{displayName(person)}</span>
        {lifespan(person) && <span className="relative-dates">{lifespan(person)}</span>}
      </button>
      {meta}
    </span>
  );
}

function EditLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-button icon-button-small" aria-label={label} title={label} onClick={onClick}>
      <EditIcon />
    </button>
  );
}

function Fact({ label, event, extra }: { label: string; event?: LifeEvent; extra?: string }) {
  const date = formatFuzzyDate(event?.date);
  const place = event?.place;
  if (!date && !place && !extra) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {[extra, date, place].filter(Boolean).join(' · ')}
        {event?.note && <div className="muted">{event.note}</div>}
      </dd>
    </>
  );
}

function partnershipSummary(p: Partnership): string {
  const parts: string[] = [PARTNERSHIP_KIND_LABELS[p.kind]];
  if (p.start?.date && isDateKnown(p.start.date)) parts.push(formatFuzzyDate(p.start.date, 'short'));
  if (p.start?.place) parts.push(p.start.place);
  if (p.end) {
    const reason = p.end.reason ? END_REASON_LABELS[p.end.reason].toLowerCase() : 'ended';
    const when = p.end.date ? ` ${formatFuzzyDate(p.end.date, 'short')}` : '';
    parts.push(`${reason}${when}`);
  }
  return parts.join(' · ');
}

export function PersonDetails(props: Props) {
  const { index, person, onSelect, onApply, announce } = props;
  const headingId = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoToRemove, setPhotoToRemove] = useState<Id>();
  const [photoStatus, setPhotoStatus] = useState<{ busy?: boolean; error?: string }>({});

  const parents = getParents(index, person.id);
  const childGroups = getChildGroups(index, person.id);
  const siblings = getSiblings(index, person.id);
  const stepParents = getDerivedStepParents(index, person.id);
  const associations = getAssociations(index, person.id);
  const portrait = getPortrait(index, person);
  const name = displayName(person);
  const photos = person.mediaIds.map((id) => index.media.get(id)).filter((m) => m !== undefined);
  const removal = confirmDelete ? describePersonRemoval(index.tree, person.id) : undefined;

  const addPhoto = async (file: File) => {
    setPhotoStatus({ busy: true });
    try {
      const media = await prepareImage(file);
      const error = onApply('Add photo', (tree) => addMedia(tree, person.id, media));
      setPhotoStatus({ error });
      if (!error) announce('Photo added.');
    } catch (error) {
      setPhotoStatus({ error: error instanceof ImageError ? error.message : 'The photo could not be added.' });
    }
  };

  return (
    <article className="person-details" aria-labelledby={headingId}>
      <header className="details-header">
        <div className="portrait" aria-hidden={!portrait}>
          {portrait ? (
            <img src={mediaDataUrl(portrait)} alt={portrait.caption || `Portrait of ${name}`} />
          ) : (
            <span className="portrait-initials" aria-hidden="true">
              {initials(person)}
            </span>
          )}
        </div>
        <div className="details-title">
          <h2 id={headingId}>{name}</h2>
          {lifespan(person) && <p className="details-lifespan">{lifespan(person)}</p>}
          {person.alternateNames.length > 0 && (
            <p className="details-altnames">
              {person.alternateNames.map((n) => `${ALTERNATE_NAME_LABELS[n.type]}: ${n.name}`).join(' · ')}
            </p>
          )}
        </div>
      </header>

      <div className="details-actions">
        <button type="button" className="button button-primary" onClick={props.onEdit}>
          <EditIcon /> Edit
        </button>
        <Menu
          label={
            <>
              <PlusIcon /> Add relative
            </>
          }
          items={(
            [
              ['parent', 'Parent'],
              ['partner', 'Partner or spouse'],
              ['child', 'Child'],
              ['sibling', 'Sibling'],
              ['other', 'Other relationship'],
            ] as [RelationType, string][]
          ).map(([relation, label]) => ({ label, onSelect: () => props.onAddRelative(relation) }))}
        />
        <button type="button" className="button" onClick={props.onShowInTree}>
          <TargetIcon /> Show in tree
        </button>
        <button type="button" className="button button-danger-quiet" onClick={() => setConfirmDelete(true)}>
          <TrashIcon /> Delete
        </button>
      </div>

      <section className="details-section" aria-label="Facts">
        <dl className="facts">
          <Fact label="Born" event={person.birth} />
          {person.living !== 'living' && <Fact label="Died" event={person.death} />}
          <dt>Status</dt>
          <dd>{LIVING_LABELS[person.living]}</dd>
          {person.sex && (
            <>
              <dt>Sex</dt>
              <dd>{SEX_LABELS[person.sex]}</dd>
            </>
          )}
          {person.gender && (
            <>
              <dt>Gender</dt>
              <dd>{person.gender}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="details-section">
        <h3>Family</h3>
        <dl className="relations">
          <dt>Parents</dt>
          <dd>
            {parents.length === 0 ? (
              <button type="button" className="link-button" onClick={() => props.onAddRelative('parent')}>
                Add a parent
              </button>
            ) : (
              <ul className="relation-list">
                {parents.map(({ person: parent, link }) => (
                  <li key={link.id}>
                    <PersonLink
                      person={parent}
                      onSelect={onSelect}
                      meta={
                        <>
                          {link.kind !== 'biological' && <span className="badge">{PARENT_KIND_LABELS[link.kind]}</span>}
                          <EditLinkButton label={`Edit relationship with ${displayName(parent)}`} onClick={() => props.onEditParentLink(link)} />
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </dd>

          {stepParents.length > 0 && (
            <>
              <dt>Step-parents</dt>
              <dd>
                <ul className="relation-list">
                  {stepParents.map(({ person: sp, via }) => (
                    <li key={sp.id}>
                      <PersonLink person={sp} onSelect={onSelect} meta={<span className="muted small">partner of {displayName(via)}</span>} />
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}

          <dt>Partners &amp; children</dt>
          <dd>
            {childGroups.length === 0 ? (
              <span className="muted">None recorded</span>
            ) : (
              <ul className="family-groups">
                {childGroups.map((group) => (
                  <li key={group.partnership?.id ?? group.coParent?.id ?? 'none'} className="family-group">
                    <div className="family-group-head">
                      {group.coParent ? (
                        <PersonLink
                          person={group.coParent}
                          onSelect={onSelect}
                          meta={
                            group.partnership ? (
                              <>
                                <span className="muted small">{partnershipSummary(group.partnership)}</span>
                                <EditLinkButton
                                  label={`Edit partnership with ${displayName(group.coParent)}`}
                                  onClick={() => props.onEditPartnership(group.partnership!)}
                                />
                              </>
                            ) : (
                              <span className="muted small">other parent</span>
                            )
                          }
                        />
                      ) : (
                        <span className="muted">Other parent not recorded</span>
                      )}
                    </div>
                    {group.children.length > 0 && (
                      <ul className="relation-list nested" aria-label={`Children${group.coParent ? ` with ${displayName(group.coParent)}` : ''}`}>
                        {group.children.map(({ person: child, link }) => (
                          <li key={link.id}>
                            <PersonLink
                              person={child}
                              onSelect={onSelect}
                              meta={
                                <>
                                  {link.kind !== 'biological' && <span className="badge">{PARENT_KIND_LABELS[link.kind]}</span>}
                                  <EditLinkButton label={`Edit relationship with ${displayName(child)}`} onClick={() => props.onEditParentLink(link)} />
                                </>
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>

          {siblings.length > 0 && (
            <>
              <dt>Siblings</dt>
              <dd>
                <ul className="relation-list">
                  {siblings.map(({ person: sibling, kind }) => (
                    <li key={sibling.id}>
                      <PersonLink
                        person={sibling}
                        onSelect={onSelect}
                        meta={kind !== 'full' ? <span className="badge">{SIBLING_LABELS[kind]}</span> : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}

          {associations.length > 0 && (
            <>
              <dt>Other relationships</dt>
              <dd>
                <ul className="relation-list">
                  {associations.map(({ person: other, association, outgoing }) => (
                    <li key={association.id}>
                      <PersonLink
                        person={other}
                        onSelect={onSelect}
                        meta={
                          <>
                            <span className="badge">{outgoing ? `${name} is their ${association.label}` : association.label}</span>
                            <button
                              type="button"
                              className="icon-button icon-button-small"
                              aria-label={`Remove relationship with ${displayName(other)}`}
                              onClick={() => props.onRemoveAssociation(association)}
                            >
                              <TrashIcon />
                            </button>
                          </>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </section>

      {person.events.length > 0 && (
        <section className="details-section">
          <h3>Life events</h3>
          <dl className="facts">
            {person.events.map((e) => (
              <Fact key={e.id} label={e.type} event={e} />
            ))}
          </dl>
        </section>
      )}

      {person.notes.trim() && (
        <section className="details-section">
          <h3>Notes</h3>
          <Markdown source={person.notes} />
        </section>
      )}

      {person.customFields.length > 0 && (
        <section className="details-section">
          <h3>Other information</h3>
          <dl className="facts">
            {person.customFields.map((f) => (
              <Fragment key={f.id}>
                <dt>{f.label || 'Other'}</dt>
                <dd className="preserve-lines">{f.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}

      <section className="details-section">
        <h3>Photos</h3>
        {photos.length > 0 && (
          <ul className="photo-grid">
            {photos.map((m, i) => (
              <li key={m.id} className="photo-card">
                <img src={mediaDataUrl(m)} alt={m.caption || `Photo ${i + 1} of ${name}`} />
                <label className="visually-hidden" htmlFor={`caption-${m.id}`}>
                  Caption for photo {i + 1}
                </label>
                <input
                  id={`caption-${m.id}`}
                  className="input input-small"
                  placeholder="Caption"
                  defaultValue={m.caption ?? ''}
                  onBlur={(e) => {
                    const caption = e.target.value.trim();
                    if (caption === (m.caption ?? '')) return;
                    const updated = { ...m };
                    if (caption) updated.caption = caption;
                    else delete updated.caption;
                    onApply('Edit photo caption', (tree) => updateMedia(tree, updated));
                  }}
                />
                <div className="photo-actions">
                  {i === 0 ? (
                    <span className="badge">Portrait</span>
                  ) : (
                    <button type="button" className="link-button small" onClick={() => onApply('Set portrait', (tree) => setPortrait(tree, person.id, m.id))}>
                      Use as portrait
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotoToRemove(m.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <label className="button button-small file-button">
          <PhotoIcon /> {photoStatus.busy ? 'Adding photo…' : 'Add photo'}
          <input
            type="file"
            accept="image/*"
            className="visually-hidden"
            disabled={photoStatus.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void addPhoto(file);
            }}
          />
        </label>
        <p className="hint">Photos are resized, stripped of location and camera metadata, and encrypted inside your tree file.</p>
        {photoStatus.error && (
          <p className="form-error" role="alert">
            {photoStatus.error}
          </p>
        )}
      </section>

      {confirmDelete && removal && (
        <ConfirmDialog
          title={`Delete ${name}?`}
          confirmLabel="Delete person"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            const error = onApply(`Delete ${name}`, (tree) => removePerson(tree, person.id));
            if (!error) {
              announce(`${name} was deleted. You can undo this.`);
              props.onDeleted();
            }
          }}
        >
          <p>This removes {name} and everything recorded about them:</p>
          <ul>
            <li>{removal.parentLinks} parent/child relationship(s)</li>
            <li>{removal.partnerships} partnership(s)</li>
            {removal.associations > 0 && <li>{removal.associations} other relationship(s)</li>}
            {removal.media > 0 && <li>{removal.media} photo(s)</li>}
          </ul>
          <p>Other people are not deleted. You can undo this until you close the tree.</p>
        </ConfirmDialog>
      )}

      {photoToRemove && (
        <ConfirmDialog
          title="Remove this photo?"
          confirmLabel="Remove photo"
          danger
          onCancel={() => setPhotoToRemove(undefined)}
          onConfirm={() => {
            const id = photoToRemove;
            setPhotoToRemove(undefined);
            onApply('Remove photo', (tree) => removeMedia(tree, id));
          }}
        >
          <p>The photo will be removed from the tree.</p>
        </ConfirmDialog>
      )}
    </article>
  );
}
