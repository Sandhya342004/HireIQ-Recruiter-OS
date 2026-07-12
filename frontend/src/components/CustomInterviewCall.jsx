import { 
  useTracks, 
  VideoTrack, 
  useLocalParticipant, 
  useRoomContext 
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useState, useEffect } from 'react';
import { 
  MdMic, 
  MdMicOff, 
  MdVideocam, 
  MdCallEnd, 
  MdSettings,
  MdVideocamOff as MdCameraOff
} from 'react-icons/md';

export default function CustomInterviewCall({ onLeave, candidateName, recruiterName }) {
  const room = useRoomContext();
  const { 
    localParticipant, 
    isMicrophoneEnabled, 
    isCameraEnabled 
  } = useLocalParticipant();

  const [devices, setDevices] = useState({ video: [], audio: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState('');
  const [isVertical, setIsVertical] = useState(window.innerHeight > window.innerWidth);

  // Handle window resizing and orientation changes
  useEffect(() => {
    const handleResize = () => {
      setIsVertical(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load available devices
  useEffect(() => {
    async function loadDevices() {
      // Request mic permission first
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.warn('Microphone permission request skipped or denied:', e);
      }
      // Request camera permission next
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e) {
        console.warn('Camera permission request skipped or denied:', e);
      }

      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devs.filter(d => d.kind === 'videoinput');
        const audioDevs = devs.filter(d => d.kind === 'audioinput');

        setDevices({ video: videoDevs, audio: audioDevs });

        if (videoDevs.length > 0) setSelectedVideoId(videoDevs[0].deviceId);
        if (audioDevs.length > 0) setSelectedAudioId(audioDevs[0].deviceId);
      } catch (err) {
        console.error('Failed to load media devices', err);
      }
    }
    loadDevices();
  }, []);

  // Handle device switch
  const handleVideoDeviceChange = async (deviceId) => {
    setSelectedVideoId(deviceId);
    if (room) {
      try {
        await room.switchActiveDevice('videoinput', deviceId);
      } catch (err) {
        console.error('Failed to switch video device', err);
      }
    }
  };

  const handleAudioDeviceChange = async (deviceId) => {
    setSelectedAudioId(deviceId);
    if (room) {
      try {
        await room.switchActiveDevice('audioinput', deviceId);
      } catch (err) {
        console.error('Failed to switch audio device', err);
      }
    }
  };

  // Get tracks in the room
  const trackRefs = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true }
    ],
    { onlySubscribed: false }
  );

  // Filter track references
  const candidateTrackRef = trackRefs.find(
    ref => ref.participant.identity.startsWith('candidate-')
  );

  const recruiterTrackRef = trackRefs.find(
    ref => !ref.participant.identity.startsWith('candidate-')
  );

  // Helper to check if a track reference is actively publishing video
  const isPublishingVideo = (trackRef) => {
    if (!trackRef) return false;
    if (trackRef.publication && !trackRef.publication.isMuted && trackRef.publication.track) {
      return true;
    }
    return trackRef.participant.isCameraEnabled;
  };

  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      background: '#090d16', 
      display: 'flex', 
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      {/* Upper Area: Dynamic Responsive Video Grid */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: isVertical ? 'column' : 'row', 
        gap: '12px', 
        padding: '16px',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}>
        
        {/* Tile 1: Recruiter */}
        <div style={{ 
          position: 'relative', 
          height: isVertical ? '50%' : '100%',
          width: isVertical ? '100%' : '50%',
          borderRadius: '16px', 
          overflow: 'hidden', 
          background: '#0f172a', 
          border: recruiterTrackRef?.participant.isSpeaking ? '3px solid #10b981' : '1px solid #1e293b',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          transition: 'border 0.2s',
          boxSizing: 'border-box'
        }}>
          {recruiterTrackRef && isPublishingVideo(recruiterTrackRef) ? (
            <VideoTrack 
              trackRef={recruiterTrackRef} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
          ) : (
            <div style={{ textAlign: 'center', color: '#64748b' }}>
              <div style={{ 
                width: '72px', 
                height: '72px', 
                borderRadius: '50%', 
                background: '#1e293b', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                margin: '0 auto 12px',
                fontSize: '28px',
                color: '#818cf8',
                fontWeight: 600
              }}>
                {recruiterName ? recruiterName[0].toUpperCase() : 'HR'}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                {recruiterName || 'Interviewer'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                {recruiterTrackRef ? 'Camera Muted' : 'Connecting interviewer stream...'}
              </div>
            </div>
          )}

          {/* Overlay Status Bar */}
          <div style={{ 
            position: 'absolute', 
            bottom: '12px', 
            left: '12px', 
            padding: '6px 12px', 
            borderRadius: '8px', 
            background: 'rgba(15, 23, 42, 0.75)', 
            backdropFilter: 'blur(8px)',
            color: '#fff', 
            fontSize: '12px', 
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
            zIndex: 10
          }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: recruiterTrackRef ? '#10b981' : '#f59e0b' 
            }} />
            {recruiterName || 'Interviewer (Host)'} {recruiterTrackRef?.participant.isLocal ? '(You)' : ''}
            {!recruiterTrackRef?.participant.isMicrophoneEnabled && (
              <span style={{ color: '#ef4444', marginLeft: '4px', fontSize: '10px' }}>[MUTED]</span>
            )}
          </div>
        </div>

        {/* Tile 2: Candidate */}
        <div style={{ 
          position: 'relative', 
          height: isVertical ? '50%' : '100%',
          width: isVertical ? '100%' : '50%',
          borderRadius: '16px', 
          overflow: 'hidden', 
          background: '#0f172a', 
          border: candidateTrackRef?.participant.isSpeaking ? '3px solid #10b981' : '1px solid #1e293b',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          transition: 'border 0.2s',
          boxSizing: 'border-box'
        }}>
          {candidateTrackRef && isPublishingVideo(candidateTrackRef) ? (
            <VideoTrack 
              trackRef={candidateTrackRef} 
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: candidateTrackRef.participant.isLocal ? 'scaleX(-1)' : 'none' }} 
            />
          ) : (
            <div style={{ textAlign: 'center', color: '#64748b' }}>
              <div style={{ 
                width: '72px', 
                height: '72px', 
                borderRadius: '50%', 
                background: '#1e293b', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                margin: '0 auto 12px',
                fontSize: '28px',
                color: '#10b981',
                fontWeight: 600
              }}>
                {candidateName ? candidateName[0].toUpperCase() : 'C'}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                {candidateName || 'Candidate'}
              </div>
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                {candidateTrackRef ? 'Camera Muted' : 'Waiting for candidate to join...'}
              </div>
            </div>
          )}

          {/* Overlay Status Bar */}
          <div style={{ 
            position: 'absolute', 
            bottom: '12px', 
            left: '12px', 
            padding: '6px 12px', 
            borderRadius: '8px', 
            background: 'rgba(15, 23, 42, 0.75)', 
            backdropFilter: 'blur(8px)',
            color: '#fff', 
            fontSize: '12px', 
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
            zIndex: 10
          }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: candidateTrackRef ? '#10b981' : '#f59e0b' 
            }} />
            {candidateName || 'Candidate'} {candidateTrackRef?.participant.isLocal ? '(You)' : ''}
            {!candidateTrackRef?.participant.isMicrophoneEnabled && (
              <span style={{ color: '#ef4444', marginLeft: '4px', fontSize: '10px' }}>[MUTED]</span>
            )}
          </div>
        </div>

      </div>

      {/* Solid Control Bar at the Bottom (Zoom-Style) */}
      <div style={{ 
        height: '72px', 
        background: '#0f172a', 
        borderTop: '1px solid #1e293b',
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        gap: '16px',
        padding: '0 20px',
        position: 'relative',
        zIndex: 1000
      }}>
        {/* Toggle Mic */}
        <button 
          onClick={() => localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)}
          style={{ 
            width: '44px', 
            height: '44px', 
            borderRadius: '50%', 
            border: 'none', 
            background: isMicrophoneEnabled ? '#3b82f6' : '#ef4444', 
            color: '#fff', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            transition: 'background 0.2s'
          }}
          title={isMicrophoneEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
        >
          {isMicrophoneEnabled ? <MdMic size={20} /> : <MdMicOff size={20} />}
        </button>

        {/* Toggle Camera */}
        <button 
          onClick={() => localParticipant?.setCameraEnabled(!isCameraEnabled)}
          style={{ 
            width: '44px', 
            height: '44px', 
            borderRadius: '50%', 
            border: 'none', 
            background: isCameraEnabled ? '#3b82f6' : '#ef4444', 
            color: '#fff', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            transition: 'background 0.2s'
          }}
          title={isCameraEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {isCameraEnabled ? <MdVideocam size={20} /> : <MdCameraOff size={20} />}
        </button>

        {/* Toggle Settings popup */}
        <div style={{ position: 'relative' }}>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            style={{ 
              width: '44px', 
              height: '44px', 
              borderRadius: '50%', 
              border: 'none', 
              background: showSettings ? '#475569' : '#1e293b', 
              color: '#fff', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              transition: 'background 0.2s'
            }}
            title="Device Settings"
          >
            <MdSettings size={20} />
          </button>

          {/* Settings Popup */}
          {showSettings && (
            <div style={{ 
              position: 'absolute', 
              bottom: '56px', 
              right: '-108px', 
              width: '260px', 
              background: '#0f172a', 
              border: '1px solid #334155', 
              borderRadius: '12px', 
              padding: '16px', 
              boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              color: '#fff',
              zIndex: 1001
            }}>
              <h4 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>DEVICE SETTINGS</h4>
              
              {/* Video Device Select */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>CAMERA</label>
                <select 
                  value={selectedVideoId} 
                  onChange={(e) => handleVideoDeviceChange(e.target.value)}
                  style={{ 
                    width: '100%', 
                    background: '#1e293b', 
                    color: '#fff', 
                    border: '1px solid #334155', 
                    borderRadius: '6px', 
                    padding: '6px 8px', 
                    fontSize: '12px',
                    outline: 'none'
                  }}
                >
                  {devices.video.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}`}</option>
                  ))}
                  {devices.video.length === 0 && <option value="">No Camera Found</option>}
                </select>
              </div>

              {/* Audio Device Select */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>MICROPHONE</label>
                <select 
                  value={selectedAudioId} 
                  onChange={(e) => handleAudioDeviceChange(e.target.value)}
                  style={{ 
                    width: '100%', 
                    background: '#1e293b', 
                    color: '#fff', 
                    border: '1px solid #334155', 
                    borderRadius: '6px', 
                    padding: '6px 8px', 
                    fontSize: '12px',
                    outline: 'none'
                  }}
                >
                  {devices.audio.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 4)}`}</option>
                  ))}
                  {devices.audio.length === 0 && <option value="">No Mic Found</option>}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* separator line */}
        <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)' }} />

        {/* Leave Call */}
        <button 
          onClick={onLeave}
          style={{ 
            width: '44px', 
            height: '44px', 
            borderRadius: '50%', 
            border: 'none', 
            background: '#ef4444', 
            color: '#fff', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(239,68,68,0.3)',
            transition: 'background 0.2s'
          }}
          title="Exit Session"
        >
          <MdCallEnd size={22} />
        </button>
      </div>
    </div>
  );
}
