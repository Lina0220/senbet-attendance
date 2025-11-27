import { Link } from 'react-router-dom';

const LandingPage = () => (
  <div className="landing-page landing-centered">
    <header className="landing-hero card landing-hero-minimal">
      <h1 className="landing-title-am">
        የፍኖተ ሎዛ ቅድስት ማርያም ቤተ ክርስቲያን
        <br />
        መራሔ ጽድቅ ሰንበት ትምህርት ቤት 
      </h1>
      <div className="hero-actions hero-actions-centered">
        <Link className="btn btn-primary" to="/auth">
          Login / Sign up
        </Link>
      </div>
    </header>
  </div>
);

export default LandingPage;

